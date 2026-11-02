# Project BEACON

**Offline-first knowledge, evidence and resilience platform.** 🔦

> **Project status (2026-11-02):** Documentation and architecture planning only. An application has **not** been scaffolded or released. No security or emergency functions should be assumed operational.

BEACON is intended to make important information usable even when internet access, external accounts or AI services are unavailable. Its initial version focuses on a searchable local document archive, a transparent evidence-analysis workspace, and portable export/import.

BEACON is a general-purpose tool. A user's theological, historical or geopolitical research can live in an **optional** research collection; it is not presented as verified emergency advice.

## Planned modules

| Module | Purpose | Version |
| --- | --- | --- |
| **Archive** | Offline import, reading and full-text search for user-owned documents | 0.1 |
| **Watchtower** | Events, sources, hypotheses and evidence links, preserving provenance | 0.1 |
| **Seed** | Versioned portable archive export/import with integrity checks | 0.1 |
| **Lifeline** | Curated practical preparedness references and checklists | 0.2 |
| **Network** | Explore local device and off-grid communications using established systems | 0.3, feasibility first |

## Planned technical foundation

- **Application:** Tauri 2 + React + TypeScript + Vite
- **Native layer:** Rust
- **Storage and search:** SQLite + FTS5, with original files preserved separately
- **First target:** Windows desktop, followed by real-device Android validation
- **Invariants:** offline-first, no required login or cloud AI, portable content, explicit sourcing, no automatic upload of imported documents

The final commands for building and running the application will be added **after** the first scaffold exists.

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

**Suggested first assignment:** [B-001 through B-005 in TASKS.md](TASKS.md). Create a minimal working, locally persistent Windows application that launches offline. Show real commands and test results before claiming completion.

## License and distribution

A software license has **not** been selected yet. Until the repository owner adds a license, do not assume code or bundled material is licensed for unrestricted reuse. Content packs require appropriate rights and attribution, separate from the software license.

## What BEACON is not

It is not an automated prophetic prediction engine, an emergency dispatch platform, a substitute for professional medical advice, an encrypted messenger, or a replacement for independent backups.

Its engineering promise is modest but concrete: **important knowledge should remain useful when the network doesn't.**
