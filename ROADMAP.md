# BEACON Roadmap

**Status:** Planning baseline (2026-11-02). Dates are targets, not guarantees. The product owner controls scope.

## Vision
An offline-first, portable knowledge and resilience platform. The foundation is useful for everyday research and real infrastructure disruptions regardless of any particular prediction or interpretation.

### Operating modes

| Situation | Required behavior |
| --- | --- |
| Normal connection | Local features remain local; future opt-in external services may enrich the library |
| Degraded connection | Imported content and saved evidence remain searchable without external authentication |
| Fully offline | Launch, search, read, create research records, and export/import packs without internet, subject to device power and storage |

## Version 0.1: First Light
Initial effort: roughly 8 weeks, starting November 2, 2026. **Proposed release target: December 27, 2026**, contingent on testing.

| Week | Target dates | Deliverable | Demo |
| --- | --- | --- | --- |
| 1 | Nov 2–8 | Tauri 2 / React / Rust project shell, SQLite setup and migrations | Desktop window launches offline |
| 2 | Nov 9–15 | Markdown and text import, document reader and SQLite FTS5 | Import, search, restart, search again |
| 3 | Nov 16–22 | Bible reference/verse navigation using permitted content | Read and reference a passage offline |
| 4 | Nov 23–29 | Watchtower events, sources, hypotheses and links | Evidence-backed event timeline |
| 5 | Nov 30–Dec 6 | Owner-approved Project E research import and categorization | Evidence and interpretation distinguished |
| 6 | Dec 7–13 | Versioned Seed pack export/import and SHA-256 verification | Restore on clean install; tampered pack rejected |
| 7 | Dec 14–20 | Android build and real-device offline checks | Mobile functionality verified or gaps logged |
| 8 | Dec 21–27 | Regression tests, release notes, security review, packaging | First Light release candidate |

### Release gates
- [ ] Fresh Windows install launches without internet, login or remote service.
- [ ] Markdown/TXT imports preserve original file contents; local search works.
- [ ] Local state survives restart and app upgrades.
- [ ] Watchtower records and evidence links work offline.
- [ ] Research distinguishes report, observation, interpretation and forecast.
- [ ] Seed pack round trip preserves records and original document bytes.
- [ ] Tampered, malformed, oversized and malicious-path packs fail safely.
- [ ] Android core flows verified on a real device, or release scope explicitly revised.
- [ ] Source attribution and redistribution rights documented.
- [ ] Test and build commands, known limits and recovery instructions documented.

## Version 0.2: Lifeline
**Exploration target:** January–February 2027.

Curated emergency references and checklists, printable communication plans, provenance/review dates, accessible offline viewing, and optional expansion with permitted knowledge packs. Practical emergency guidance must not be derived from geopolitical or theological forecasts.

## Version 0.3: Network
**Exploration target:** March–May 2027, dependent on security and device testing.

USB/file-based pack exchange first, then feasibility of local LAN exchange and compatibility with existing off-grid communication tools. No promised anonymity, encryption guarantees, or unlimited radio coverage. Do not invent a messaging encryption protocol.

## Later
Optional online source collection, visualization of evidence relationships, carefully evaluated hypothesis scoring, opt-in AI, broader formats, localization, and accessibility improvements.

See [TASKS.md](TASKS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DECISIONS.md](DECISIONS.md).
