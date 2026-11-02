# Project BEACON

**Offline-first knowledge, evidence and resilience platform.** 🔦

> **Project status (2026-11-02):** The Sprint 001 "First Light" foundation (Tauri 2 + React + TypeScript + Rust + SQLite) is **implemented but has not yet been built or launched on Windows.** The authoring environment had no access to the npm/crates.io registries or to Tauri's system libraries. [TASKS.md](TASKS.md) records exactly what has and has not been verified. No security or emergency functions should be assumed operational.

BEACON is intended to make important information usable even when internet access, external accounts or AI services are unavailable. Its initial version focuses on a searchable local document archive, a transparent evidence-analysis workspace, and portable export/import.

BEACON is a general-purpose tool. A user's theological, historical or geopolitical research can live in an **optional** research collection; it is not presented as verified emergency advice.

## What exists today (Sprint 001)

- A dark-mode desktop window branded **PROJECT BEACON** with navigation for Archive, Watchtower, Lifeline and Settings. Watchtower and Lifeline are clearly labeled **Not implemented** placeholders.
- A local **SQLite** database created on first launch in the per-user application-data directory, managed by **versioned, forward-only migrations**.
- **Archive** hosts a simple local notes demo: create a plain-text note and view it. Notes are stored in SQLite and are meant to survive closing and reopening the app.
- No account, no cloud connection, no telemetry, no external API, and no networking dependency.

**Not implemented yet:** document import, full-text search, Watchtower records, Seed export/import, encryption at rest, backup, and Android packaging. Notes are **not encrypted**.

## Planned modules

| Module         | Purpose                                                                       | Version               |
| -------------- | ----------------------------------------------------------------------------- | --------------------- |
| **Archive**    | Offline import, reading and full-text search for user-owned documents         | 0.1 (notes demo now)  |
| **Watchtower** | Events, sources, hypotheses and evidence links, preserving provenance         | 0.1                   |
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

The first `tauri dev` compiles all Rust dependencies (including SQLite) and can take several minutes; later runs are fast. A desktop window titled **PROJECT BEACON** should open.

> `npm install` and the first Rust build generate `package-lock.json` and `src-tauri/Cargo.lock`. **Commit both** (they could not be generated in the authoring environment) and then switch CI from `npm install` to `npm ci`.

Running `npm run dev` alone starts only the web UI in a browser. That is not supported: the page will report that the BEACON backend is unavailable, because the data layer lives in the Tauri/Rust process.

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

Continuous integration (`.github/workflows/ci.yml`) runs all of these on a Windows runner, plus a release build.

Offline behaviour has an automated guard and a manual airplane-mode procedure; see [docs/OFFLINE-VERIFICATION.md](docs/OFFLINE-VERIFICATION.md).

## Where your data lives

| What     | Location (Windows)                                      |
| -------- | ------------------------------------------------------- |
| Database | `%APPDATA%\org.projectbeacon.desktop\beacon.db`         |
| WAL files | `beacon.db-wal`, `beacon.db-shm` beside it (normal for SQLite) |

Settings inside the app shows the exact path. To start from scratch, close BEACON and delete that folder. The database is **not encrypted**, so anyone with access to your Windows account can read it, and there is no backup or export yet: keep your own copies of anything important.

## Project layout

```text
src/                     React + TypeScript frontend
  api/                   BeaconApi interface, Tauri implementation, error mapping
  components/            Sidebar, shared UI pieces
  modules/               Archive (notes), Watchtower/Lifeline placeholders, Settings
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

## Known limitations (Sprint 001)

- Not yet built, launched or tested on Windows; see [TASKS.md](TASKS.md).
- No lockfiles are committed yet (see above).
- Notes can be created and viewed only: no edit, delete, search, import or export.
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
