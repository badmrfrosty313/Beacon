# Architecture Decision Log (ADRs)

Last reviewed: 2026-11-02.

Each decision records its status, rationale and tradeoffs. A **proposed** choice should not be described as implemented.

## ADR-001: Offline-first product
**Status:** Accepted (design decision).

Core archive, research records and portable export/import must not require connectivity, remote authentication or hosted AI. Future online enrichment is opt-in and additive.

**Tradeoffs:** Limited live information; explicit update/backup processes are needed.

## ADR-002: Proposed application stack
**Status:** Accepted as planned direction; not implemented.

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

## Open decisions
- **OD-001:** Final SQLite schema, migration implementation and FTS update strategy.
- **OD-002:** Exact document file layout, IDs, duplicate-detection behavior and storage limits.
- **OD-003:** Archive container format, version migration and import transaction semantics.
- **OD-004:** Safe Bible/source licensing and packaging model.
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
