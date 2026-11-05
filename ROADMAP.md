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

## Priority research spike: offline private messaging
**Priority:** High; begin feasibility/security work as soon as capacity allows, independently of Sprint 003. **Not a v0.1 deliverable and not yet implemented.** The owner wants this assessed early rather than forgotten until spring 2027.

| Stage | Scope | Exit condition |
| --- | --- | --- |
| N-001: Threat model and requirements | Identify realistic offline delivery paths, device/platform constraints, attacker models, peer verification, local key security, relay/metadata risks | Written threat model, credible security design and explicit non-guarantees |
| N-002: Transport and crypto evaluation | Evaluate established cryptographic protocols/libraries and LAN, local file/USB, Android proximity and Windows APIs; review licenses and permissions | Documented approach, dependencies, platform feasibility, independent security review plan |
| N-003: Minimal non-production proof of concept | Two test devices exchange a protected message without the internet via one chosen transport | Device-to-device demo, verified recipients, known failure cases and reproducible tests |
| N-004: Productization decision | Review privacy, accessibility, key recovery, usability, threat model and audit findings | Explicit owner go/no-go and staged implementation plan; no implied launch date |

Do not interrupt Scripture PR #5 or introduce network permissions into the offline-only v0.1 build just to start this research. See [docs/NETWORK-MESSAGING.md](docs/NETWORK-MESSAGING.md) for the proposed design and security gates.

## Version 0.3: Network
**Exploration target:** March–May 2027 for productized functionality, subject to feasibility and security review; early research begins sooner.

Build on the early messaging spike. Start with opt-in, verified-contact, end-to-end encrypted person-to-person messaging over a proven offline transport (local file/USB or local LAN); only then assess direct Wi-Fi/Bluetooth, queued store-and-forward delivery, and optional compatibility with established off-grid radios (such as Meshtastic). Keep transport, cryptography and local message storage separate. Do not promise internet-free delivery without physical connectivity, guaranteed delivery, anonymity, unlimited range or security assurances without review. Do not invent a messaging encryption protocol.

## Later
Optional online source collection, visualization of evidence relationships, carefully evaluated hypothesis scoring, opt-in AI, broader formats, localization, and accessibility improvements.

See [TASKS.md](TASKS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DECISIONS.md](DECISIONS.md).
