# Project BEACON

**Offline-first knowledge, evidence and resilience platform.** 🔦

> **Project status (2026-11-02):** The Sprint 001 Windows foundation is built and tested in
> [successful CI run 41550072221](https://github.com/badmrfrosty313/Beacon/actions/runs/41550072221).
> **A person has now launched the native Windows EXE and confirmed a saved note survives an
> application restart.** The browser demo is deployed and its separate note persistence test also
> passed. **Full airplane-mode verification and clean first-launch testing have not been
> explicitly confirmed**; dependency lockfiles also remain to be committed. See [TASKS.md](TASKS.md).
> **Sprint 002 (document library) is on branch `feature/sprint-002-archive` and has not been
> manually tested by a person**; its automated status is in [TASKS.md](TASKS.md).
> **Sprint 003 (offline Scripture reader) is on branch `feature/sprint-003-scripture`; it has not
> been launched or tried by a person**, and CI has not yet run on it. See [TASKS.md](TASKS.md).
> **Sprint 004 (Watchtower research workspace) is on branch `feature/sprint-004-watchtower`; it has not
> been launched or tried by a person.** See [TASKS.md](TASKS.md) for exactly what has been verified.
> **Sprint 005 (private research import) is on branch `feature/sprint-005-research-import`; it has not
> been launched or tried by a person.** See [TASKS.md](TASKS.md) for exactly what has been verified.
> No advanced security or emergency functions should be assumed operational.

BEACON is intended to make important information usable even when internet access, external accounts or AI services are unavailable. Its initial version focuses on a searchable local document archive, a transparent evidence-analysis workspace, and portable export/import.

BEACON is a general-purpose tool. A user's theological, historical or geopolitical research can live in an **optional** research collection; it is not presented as verified emergency advice.

## What exists today (Sprints 001 to 005)

- A dark-mode desktop window branded **PROJECT BEACON** with navigation for Archive, Scripture, Watchtower, Lifeline and Settings. Lifeline is a clearly labeled **Not implemented** placeholder.
- A local **SQLite** database created on first launch in the per-user application-data directory, managed by **versioned, forward-only migrations**.
- **Archive → Documents** (Sprint 002): import Markdown (`.md`) and plain-text (`.txt`) files (UTF-8, up to 1 MiB each), keep the exact original bytes with a SHA-256 fingerprint, search them offline with SQLite FTS5 (words, or `"exact phrases"`), and read them safely as plain text. Duplicates are detected by hash.
- **Archive → Notes**: the Sprint 001 plain-text notes, unchanged.
- **Scripture** (Sprint 003): the complete World English Bible (Protestant, 66 books; public domain, packaged with the app, see [ADR-014](DECISIONS.md)). Pick a book and chapter or type a reference (`John 3:16`, `Rev 13:16-18`, `1 John 4:1`, `Psalm 23`), read verse by verse, step to the previous/next chapter, select a verse or range, **copy the canonical reference**, or **Create note from reference** (a normal note whose first line is `Scripture reference: Revelation 13:18 (WEB)`; the note links back to the passage). No Scripture text is fetched at run time and BEACON adds no commentary. Regenerate or verify the packaged data with `npm run scripture:verify`.
- **Watchtower** (Sprint 004): a private research workspace. Record **events** (with a stated date, or none), **sources** (author, publisher, address, published and retrieved dates, optional link to an Archive document), **statements** classified as *observation*, *attributed claim*, *interpretation* or *forecast*, and **hypotheses** (propositions with a status you control). Link evidence to a hypothesis as *supports*, *contradicts* or *context* with a written reason, and view an event-date-ordered timeline. BEACON never fetches a source address, never scores or concludes, and nothing leaves the device. See [ADR-015](DECISIONS.md). Limitations: no delete, no history, no export yet.
- **Archive → Research** (Sprint 005): a private library for your own research. Review a text-layer **PDF**, Markdown or text file *before* anything is stored (file name, type, SHA-256, extracted text, extraction limits), choose a collection (for example Convergence research, Biblical research, Astronomy, General research), add author, source and date details, and import. The original is kept byte for byte and re-verified whenever you open it; the extracted text is a derivative. Importing the same file twice is detected. Search is local, and you may optionally map a document into Watchtower (create a source, record an excerpt in a class *you* choose, attach it to a hypothesis) one deliberate step at a time. There is no OCR, nothing is published or uploaded, and private research never belongs in this repository. See [ADR-016](DECISIONS.md).
- Everything is stored locally and survives closing and reopening the app. The hosted **browser demo** has the same workflow over IndexedDB, with a clearly labeled, simpler word search (see [docs/BROWSER-DEMO.md](docs/BROWSER-DEMO.md)).
- No account, no cloud connection, no telemetry, no external API, and no networking dependency.

**Not implemented yet:** deleting or exporting documents, PDF/other formats, deleting or exporting Watchtower records, Seed export/import, encryption at rest, backup, and Android packaging. Notes are **not encrypted**.

## Planned modules

| Module         | Purpose                                                                       | Version               |
| -------------- | ----------------------------------------------------------------------------- | --------------------- |
| **Archive**    | Offline import, reading and full-text search for user-owned documents         | 0.1 (notes demo now)  |
| **Scripture**  | Offline Bible reader, reference lookup and links into notes                   | 0.1 (Sprint 003)      |
| **Watchtower** | Events, sources, hypotheses and evidence links, preserving provenance         | 0.1 (Sprint 004)      |
| **Seed**       | Versioned portable archive export/import with integrity checks                | 0.1                   |
| **Lifeline**   | Curated practical preparedness references and checklists                      | 0.2                   |
| **Network**    | Explore local device and off-grid communications using established systems    | 0.3, feasibility only |

## Technical foundation

- **Application:** Tauri 2 + React 19 + TypeScript + Vite
- **Native layer:** Rust (`src-tauri/`), exposing a small set of Tauri commands
- **Storage:** SQLite via `rusqlite` (bundled SQLite), SQL-file migrations
- **First target:** Windows desktop, followed by real-device Android validation (the crate is already structured with a mobile entry point)
- **Invariants:** offline-first, no required login or cloud AI, portable content, explicit sourcing, no automatic upload of imported documents

## Prerequisites (Windows 10 / 11)

1. **Node.js 20 or newer** (22 LTS recommended) and npm.
2. **Rust** (stable, MSVC toolchain): install with [rustup](https://rustup.rs) and choose the `x86_64-pc-windows-msvc` host.
3. **Microsoft C++ Build Tools** (Visual Studio Build Tools, workload "Desktop development with C++").
4. **Microsoft Edge WebView2 Runtime** (preinstalled on Windows 11 and current Windows 10).

Tauri's official prerequisites page covers these in detail: <https://v2.tauri.app/start/prerequisites/>. You need internet access **once**, to download dependencies. The built application does not.

## Install and run

```powershell
git clone https://github.com/badmrfrosty313/Beacon.git
cd Beacon
npm install
npm run tauri dev
```

The first `tauri dev` compiles all Rust dependencies (including SQLite) and can take several minutes; later runs are fast. A desktop window titled **PROJECT BEACON** should open. The downloaded release EXE has been launched and its notes persisted across a restart; `tauri dev` itself has not been manually verified.

> `npm install` and the first Rust build generate `package-lock.json` and `src-tauri/Cargo.lock`. **Commit both** (they could not be generated in the authoring environment) and then switch CI from `npm install` to `npm ci`. Until then CI resolves dependency versions fresh on every run.

### Manually verify that notes persist (about 3 minutes)

1. `npm run tauri dev` (or run the built `src-tauri\target\release\beacon.exe`). Wait for the window.
2. Open **Settings** and note the database path (`...\org.projectbeacon.desktop\beacon.db`) and schema version (expect 1).
3. In **Archive**, create a note titled `Persistence check` with any text. It should appear in the list and open on click.
4. Close the window, confirm no `beacon.exe` remains in Task Manager, start the app again.
5. Expected: the note is still listed with the same title, text and timestamp.
6. Optional: with Windows Explorer open the folder from step 2 and confirm `beacon.db` exists.

For the airplane-mode variant, follow [docs/OFFLINE-VERIFICATION.md](docs/OFFLINE-VERIFICATION.md) and add a row to its results table.

Running `npm run dev` alone starts only the web UI in a browser. That is not supported: the page will report that the BEACON backend is unavailable, because the data layer lives in the Tauri/Rust process.

## Browser demo (separate development harness)

A browser-only demo is available for reviewing the interface without rebuilding the Windows desktop app.
It runs the same React UI but uses an **explicitly selected browser IndexedDB adapter** instead of
Tauri IPC + native SQLite. This is not an offline/native acceptance test, a secure vault, or a backup.

To preview locally:

```powershell
npm install
npm run dev:demo
```

To produce a static deployable build:

```powershell
npm run build:demo
```

On merge to `main`, `.github/workflows/browser-demo.yml` builds and attempts to publish a GitHub Pages
preview at `https://badmrfrosty313.github.io/Beacon/`. Repository Settings → Pages must be configured
for GitHub Actions for the URL to work; publishing is not confirmed until the deployment job succeeds.

**Use dummy data only:** demo notes remain in unencrypted browser IndexedDB, and clearing site data
deletes them. The hosted page requires a network to load; it does not upload notes or use
an account or remote backend. Desktop Tauri errors never silently fall back to this demo.

See [docs/BROWSER-DEMO.md](docs/BROWSER-DEMO.md) and [issue #2](https://github.com/badmrfrosty313/Beacon/issues/2).

## Download and test a Windows desktop build

The latest successful `CI` workflow run on `main` publishes a **no-installer Windows test
executable** as a GitHub Actions artifact, available for 14 days. You do **not** need Node,
Rust, or Visual Studio Build Tools to run the downloaded binary.

1. Open [GitHub Actions → CI](https://github.com/badmrfrosty313/Beacon/actions/workflows/ci.yml).
2. Select the latest **successful** workflow run for `main`.
3. Under **Artifacts**, download `beacon-windows-test` and extract the ZIP.
4. Find `beacon.exe` and `SHA256SUMS.txt`. The latter records the executable's SHA-256
   hash so you can verify the downloaded binary matches the CI output.
5. Run `beacon.exe` on Windows 10/11 (WebView2 Runtime required, usually present).
   This executable is **unsigned**, so Windows may display an unrecognized-app warning.
   Only run the file after confirming it came from this repository's successful CI run.
6. Follow [the offline test procedure](docs/OFFLINE-VERIFICATION.md): first launch with the
   network disconnected, create a note, close and restart, and verify the note remains.

**This is not an installer** and it does not store data beside the EXE. Notes use the
regular `%APPDATA%\\org.projectbeacon.desktop\\beacon.db` path. Do not use private or important
notes until the app has passed its real-world testing and has a backup/export feature.

## Build a release

```powershell
npm run tauri build                  # installer(s) under src-tauri\target\release\bundle\
npm run tauri build -- --no-bundle   # just src-tauri\target\release\beacon.exe
```

## Test and quality gates

| Command                | What it does                                                                |
| ---------------------- | --------------------------------------------------------------------------- |
| `npm run check`        | Prettier check, ESLint, TypeScript typecheck, Vitest (frontend)             |
| `npm run check:rust`   | `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` (Rust)        |
| `npm run check:all`    | Both of the above                                                           |
| `npm test`             | Vitest only (UI flows, API contract, validation, offline guard)             |
| `npm run rust:test`    | Rust unit and integration tests (migrations, notes, persistence across reopen) |
| `npm run format`       | Apply Prettier to code and config files                                     |

Continuous integration (`.github/workflows/ci.yml`) runs all of these on a Windows runner, plus a release build (`tauri build --no-bundle`). Each check is a separate step so one failure does not hide the others.

Offline behaviour has an automated guard and a manual airplane-mode procedure; see [docs/OFFLINE-VERIFICATION.md](docs/OFFLINE-VERIFICATION.md).

### Manually verify documents (Windows, about 5 minutes)

1. Create two small files, for example `plan.md` containing `# Plan` and `Meet at the north bridge.`, and `water.txt` containing `Store two litres per person per day.`
2. Archive → Documents → **Import documents**, and pick both.
3. Search for `"north bridge"` (with the quotes). Expect one result with the phrase highlighted. Click it: the reader shows the text, file name, format, size, time and SHA-256.
4. Import `plan.md` again: expect "already in your library", and still two documents.
5. Close BEACON completely, reopen it, and confirm both documents are listed and the search still works. (To compare fingerprints: `Get-FileHash plan.md -Algorithm SHA256` should match the value shown.)
6. Optional: with Windows Explorer open `%APPDATA%\org.projectbeacon.desktop\originals`; each file is named `<sha256>.md|txt` and is byte-identical to what you imported.

## Where your data lives

| What     | Location (Windows)                                      |
| -------- | ------------------------------------------------------- |
| Database | `%APPDATA%\org.projectbeacon.desktop\beacon.db`         |
| WAL files | `beacon.db-wal`, `beacon.db-shm` beside it (normal for SQLite) |
| Imported originals | `%APPDATA%\org.projectbeacon.desktop\originals\<sha256>.md|txt` (exact bytes as imported) |

Settings inside the app shows the exact path. To start from scratch, close BEACON and delete that folder. The database is **not encrypted**, so anyone with access to your Windows account can read it, and there is no backup or export yet: keep your own copies of anything important.

## Project layout

```text
src/                     React + TypeScript frontend
  api/                   BeaconApi interface, Tauri implementation, error mapping
  components/            Sidebar, shared UI pieces
  modules/               Archive (notes, documents), Scripture, Watchtower/Lifeline placeholders, Settings
  lib/                   Input validation (mirrors the Rust rules), formatting
  test/                  Test helpers and the offline guard
src-tauri/               Rust backend (Tauri 2)
  migrations/            Versioned SQL migrations (0001_create_notes.sql, ...)
  src/db/                Connection setup and the migration runner
  src/notes/             Note validation and SQL access
  src/commands.rs        The only functions the frontend can call
  src/state.rs           Data directory and database lifecycle
  tests/                 Rust integration tests (persistence across reopen)
  capabilities/          Tauri permissions (core only; no fs/shell/http)
docs/                    Verification procedures
```

Components never call Tauri directly: they use the `BeaconApi` interface, so they can be tested with an in-memory fake and the storage layer can evolve independently.

## Known limitations

- Windows CI build passed and owner manually confirmed the downloaded native EXE launches and saved notes survive restarting. **Airplane-mode and clean first-launch checks are still outstanding**; see [TASKS.md](TASKS.md).
- The frontend tests (Vitest) use an in-memory fake backend; they do not exercise Tauri IPC. The Rust tests exercise SQLite and migrations but not the Tauri command layer or window.
- No lockfiles are committed yet (see above), so CI dependency versions are not pinned.
- Notes can be created and viewed only. Documents can be imported, searched and read only: no edit, delete, rename, tags, export or backup yet (Seed export/import is Sprint 006).
- Markdown is shown as source text, not rendered. Only UTF-8 `.md` and `.txt` up to 1 MiB are accepted; PDFs and other formats are rejected.
- Search is word/phrase matching with FTS5 relevance ranking (best 100); no wildcards, `OR`/`NOT` operators or stemming. Documents and the search index are **not encrypted**.
- The browser demo's search is a separate, simpler implementation and can return different results than the desktop app.
- Plain text only; Markdown and HTML are displayed literally, never rendered.
- Limits: titles up to 200 characters, note text up to 100,000 bytes, and the list shows at most the 1,000 newest notes.
- Android has not been attempted.

## Repository documents

- [AGENTS.md](AGENTS.md): shared instructions for Codex, Claude and other development agents
- [CLAUDE.md](CLAUDE.md): Claude Code entry-point and project rules
- [ARCHITECTURE.md](ARCHITECTURE.md): design, storage boundaries and acceptance checks
- [ROADMAP.md](ROADMAP.md): phased delivery plan
- [TASKS.md](TASKS.md): task IDs and current sprint queue
- [DECISIONS.md](DECISIONS.md): accepted design decisions and open questions
- [CONTRIBUTING.md](CONTRIBUTING.md): branch, testing and review workflow
- [SECURITY.md](SECURITY.md): threats, privacy and responsible vulnerability handling

## Working with Claude and Codex

Both can work against this GitHub repository. They should read their root instructions (`CLAUDE.md` for Claude and `AGENTS.md` for Codex), then use the shared architecture, roadmap, tasks and decision log.

**Recommended division of work:** the product owner selects a task; one coding agent implements in a feature branch; the other reviews or tests; the owner approves merging. ChatGPT can help draft requirements, resolve design tradeoffs and review findings. Don't have two agents alter the same feature branch concurrently.

## License and distribution

A software license has **not** been selected yet. Until the repository owner adds a license, do not assume code or bundled material is licensed for unrestricted reuse. Content packs require appropriate rights and attribution, separate from the software license.

## What BEACON is not

It is not an automated prophetic prediction engine, an emergency dispatch platform, a substitute for professional medical advice, an encrypted messenger, or a replacement for independent backups.

Its engineering promise is modest but concrete: **important knowledge should remain useful when the network doesn't.**
