# PROJECT BEACON v0.1 "First Light": release candidate notes

**Status: release candidate for owner acceptance. Not released, not merged, not signed.**
Branch `feature/first-light-completion`, draft PR #11.

## What is in it
Offline-first notes, Archive (Markdown/text import, FTS5 search), packaged World English Bible reader,
Watchtower (events, sources, classified statements, hypotheses, evidence links, timeline), private Research
import (PDF text layer, Markdown, text) with explicit Watchtower mapping, **SEED backup and restore**, and an
**Android build**. No account, cloud, telemetry or AI.

New in this candidate: SEED (B-016 to B-018), Android (B-019), lockfiles and reproducible CI, mobile layout,
threat model, install/recovery documentation, a Windows test EXE on PR builds (B-020).

## Validation, stated precisely
| Level | What | Result |
| --- | --- | --- |
| CI (automated) | Prettier, ESLint, `tsc` strict, 470 Vitest tests (26 files, fake backend + fake-indexeddb), 173 Rust unit + 29 Rust integration tests, Clippy `-D warnings`, `cargo fmt`, Scripture rebuild verification, Windows release build, bundle check | Passed on `62ddcc4` (Windows `CI` run 42237713024, `Browser Demo` 42237713070, `Dependency audit` 42237713346); Codex review of that commit: no findings |
| CI (Android) | arm64 release APK builds; x86_64 **emulator** launches the app, SQLite database created, no INTERNET permission | Passed on `62ddcc4` (Android run 42237713030) |
| Browser | Hosted demo build and IndexedDB adapter incl. SEED (automated in jsdom) | Automated only; nobody has used the hosted demo by hand for this release |
| Native (Windows) | A person launching this build, offline start, SEED round trip in the real window | **Not done** |
| Device (Android) | Any physical device | **Not done: hardware gate pending** |

Not claimed: security certification, production validation, encryption (at rest or in backups), signed
distribution, accessibility certification, screen-reader testing.

## Dependency audit (CI run 42235196772, informational)
- `npm audit --omit=dev` (everything that ships in the app): **0 vulnerabilities**.
- `cargo audit` (421 crates): no vulnerabilities; 2 allowed warnings in Tauri's Linux GUI stack (`proc-macro-error`
  unmaintained, `glib` unsound), neither compiled into the Windows or Android builds.
- `npm audit` including build tooling: 10 findings (2 critical via `tinypool`, 8 moderate via `vitest`/`@vitest/mocker`
  and `minimatch` under typescript-eslint). These are **development tools only** (test runner, linter) and are not
  in the shipped app. Fixing them means a breaking Vitest major upgrade, deliberately **not** done in this candidate;
  do not run the test suite against untrusted code or mock files. Tracked as post-release maintenance.

## Artifacts
- Windows: unsigned test EXE and SHA-256 in the Windows `CI` run artifact `beacon-windows-test` (PR #11).
- Android: arm64 APK signed with a throwaway key, in the `Android` run artifact `beacon-android-arm64-test-signed`.
  Installable for testing only.

## Known limitations
- Data and SEED backups are **not encrypted or signed**; a checksum detects damage, not authorship.
- Restore only adds records (no overwrite, no merge of edits, no delete); a record edited after export is added
  beside the old one. No record deletion anywhere in v0.1.
- SEED: 64 MiB cap, whole package in memory; export fails if any archived original is missing or damaged.
- Android: export download unverified (known risk), arm64 only, unverified on hardware.
- PDF: text layer only (no OCR, no encrypted PDFs); pdf.js is a large dependency that parses untrusted input.
- Browser demo: dummy data only; capped at 200 Archive documents; word-scan search instead of FTS5.
- Migrations are forward-only; no downgrade.

## Deferred (out of scope for v0.1)
Encrypted messaging (PR #6, untouched), Public Dispatch, AI integration, cloud sync, signed releases,
at-rest encryption, delete/edit history, OCR.

See [INSTALL.md](INSTALL.md), [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md), [THREAT-MODEL.md](THREAT-MODEL.md),
[ANDROID.md](ANDROID.md), [SEED.md](SEED.md).
