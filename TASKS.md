# BEACON Task Queue

Updated: 2026-11-02. Unchecked work is not implemented. Code agents should update this file on completion and link their PR or commit.

## Sprint 001: First Light Foundation
**Objective:** Launch a working offline Windows app that can persist a simple record. Prefer a thin vertical slice over an elaborate scaffold.

- [ ] **B-001: Scaffold project.** Tauri 2 + Vite/React + TypeScript + Rust. Document prerequisites, scripts and how to start a dev build.
  - Accept: a clean checkout can build and open a working desktop window.
- [ ] **B-002: Initialize SQLite.** OS-appropriate app-data directory, migration runner, minimal versioned schema, error handling.
  - Accept: database initializes at first launch, reopens without data loss, migration tests pass.
- [ ] **B-003: Offline smoke test.** Ensure first launch and basic navigation perform no required network or authentication calls.
  - Accept: manual airplane-mode verification and a documented reproducible test.
- [ ] **B-004: Basic persistent record.** Create/list a local demo note or document metadata record using a Tauri command.
  - Accept: record persists through restart; input validation and failure behavior tested.
- [ ] **B-005: Foundation quality gates.** Formatting, linting, frontend unit tests, Rust tests, and CI compatible with actual project scripts.
  - Accept: checks documented and passing; mark unavailable platform tests clearly.

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
