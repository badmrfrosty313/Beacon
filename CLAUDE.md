# Claude Instructions: Project BEACON

This file is the primary repository guidance for Claude Code. Follow [AGENTS.md](AGENTS.md), and use the same repository documentation as other assistants. **GitHub is the shared source of truth; chat history is not.**

## Mission
Build BEACON: an offline-first, portable knowledge and resilience platform. It should preserve user-owned documents, support auditable event/evidence analysis, and work when internet connectivity or cloud AI services are unavailable.

This is a preparedness and research tool, **not** an automated prophecy predictor, emergency dispatch service, or source of unsupervised medical guidance.

## Read before making changes
1. [README.md](README.md): mission, status, navigation.
2. [ARCHITECTURE.md](ARCHITECTURE.md): constraints, data boundaries, technology.
3. [ROADMAP.md](ROADMAP.md): current release scope and acceptance tests.
4. [TASKS.md](TASKS.md): next actionable tasks.
5. [DECISIONS.md](DECISIONS.md): architecture decisions and open questions.
6. [CONTRIBUTING.md](CONTRIBUTING.md): development workflow.

## Current status
The repository begins as a documentation-only project; do not pretend that a Tauri app, database, scripts, CI, or tests already exist. Implement them incrementally, and update this statement when the first scaffold lands.

## Approved direction for v0.1
- Tauri 2 shell; React + TypeScript + Vite frontend; Rust backend; SQLite including FTS5.
- Offline document import (Markdown and plain text first), local viewing, search and persistent storage.
- Watchtower schema and basic UI for events, sources, hypotheses and evidence relationships, with provenance.
- Portable **archive export and re-import**, plus cryptographic hash verification of bytes.
- Windows as first development target; Android as a required real-device validation milestone.
- No mandatory account, cloud service, telemetry, AI API, or internet connection at launch.

**Not in v0.1:** mesh messaging, custom cryptography, live crawlers, autonomous news monitoring, public social network, prophecy confidence automation, built-in local LLM, or medical diagnosis.

## Working agreement
- Make a small plan and identify acceptance criteria before a nontrivial change.
- Prefer the smallest vertical slice that runs and is testable. Do not build abstractions for hypothetical future modules.
- Keep the core useful in airplane mode on a cold start.
- Use local-first storage with documented portable formats. Preserve original source files and metadata; SQLite indexes them but is not the only copy.
- Treat every imported document and downloaded page as untrusted input. Do not execute embedded scripts or unsanitized HTML; avoid dangerous filename/path handling.
- Distinguish SHA-256 integrity checks from authentication: a hash detects changes relative to a trusted manifest; it does not prove who authored a file. Do not claim signed distribution until keys and signature verification exist.
- Never put secrets, account tokens, private keys, personal correspondence, or sensitive data in the repository, test fixtures, logs, or commits.
- Do not transmit locally imported material to an external AI or service without an explicit user action and disclosure of what will be sent.
- Archive sources with source URL, attribution, retrieved/observed date, local timestamp where applicable, license/permission status, and hash. Don't claim a link was preserved if only a URL was stored.
- Separate documented facts, hypotheses, theological interpretation and forecasts in Watchtower. Evidence strength changes only with linked, reviewable sources. Never frame speculative claims as verified incidents.
- Verify licenses before bundling Bible translations, commentary or other documents; avoid uploading copyrighted content to this public repo without permission.
- Honor existing user documents: do not silently rewrite user-authored interpretive material.

## Before declaring a task complete
- Describe changed files, behavior, and how to verify it.
- Run relevant checks that are actually available; identify commands attempted and any failures. Never invent test results.
- Test offline behavior for features that claim to be offline.
- Update TASKS.md when a milestone changes. Add an entry in DECISIONS.md when architecture or data contracts materially change.
- Prefer feature branches and pull requests for implementation, with review before merge.

## First assignment
Follow the Week 1 tasks in [TASKS.md](TASKS.md): scaffold a minimal runnable shell, initialize SQLite with migrations, add a single end-to-end offline smoke test, and document how to run it. Do not start Network or Lifeline yet.
