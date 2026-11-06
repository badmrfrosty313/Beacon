# Threat model and security review: First Light v0.1

This is an engineering review, **not a security certification or audit by an independent party**. BEACON is a
local, single-user, offline tool. Records are **not encrypted at rest** and SEED packages are **not encrypted or
signed**.

| Surface | Threat | Mitigation | Evidence |
| --- | --- | --- | --- |
| Imported .md/.txt/PDF | Hostile content, scripts, HTML | Text only, rendered as text (no HTML injection); size, UTF-8, control-character and filename validation; originals never executed | Rust + Vitest validation suites |
| PDF parsing | Parser exploits, huge/malicious PDFs | pdf.js legacy build, no scripts executed, fake worker, 20 MiB / 3M character / page limits, text only, no encrypted PDF support. **Residual risk:** parser bugs in a large JS dependency (pinned 4.10.38) run in the WebView | pdfText tests with synthetic PDFs |
| SEED package | Path traversal, absolute/Windows paths | Only `data/records.json` and exact `<sha256>.<ext>` names are legal; nothing is extracted by name | `seed::tests`, `tests/seed.rs`, `format.test.ts` |
| SEED package | Decompression bombs | Nothing is compressed or decompressed; declared sizes must equal the file size; per-file and total caps (64 MiB, 50k rows) | same |
| SEED package | Corruption/tampering | Per-entry SHA-256 verified before any write; all-or-nothing transaction; confirmation digest | byte-flip tests (Rust and TS) |
| SEED package | Authorship forgery | **Not mitigated by design.** Digests are in the same file; no signatures. UI says so | ADR-017 |
| SEED package | Malformed records / SQL | Records are values bound as parameters; table and column names come from static lists; DB CHECK/FK constraints apply; dangling references rejected | tests |
| SQL injection | User text in queries | Parameter binding everywhere; FTS queries parsed into literal terms | existing suites |
| Network | Accidental requests/telemetry | No network crates/plugins; CSP `connect-src ipc:` only; static test bans `fetch`, XHR, WebSocket, URL literals; Android manifest has no INTERNET (CI-asserted) | `offlineGuard.test.ts`, Android workflow |
| Dependencies | Known vulnerabilities | Lockfiles committed and used (`npm ci`, `--locked`); small allowlisted dependency set; `npm audit`/`cargo audit` run in CI: 0 production npm findings; dev-tooling advisories listed in the release notes | docs/RELEASE-NOTES |
| Local privacy | Other local users/malware, device loss | Not encrypted; relies on OS account/device security. Browser demo data is in IndexedDB and must hold dummy data only | README, Settings text |
| Private research in public artifacts | Leaking real research into builds | Synthetic fixtures only; desktop bundle contains no browser-demo Scripture; no research bundled | CI bundle check, review |
| Distribution | Fake builds | Windows EXE and Android APK are **unsigned / test-signed**; SHA-256 published for integrity only | release notes |

## Out of scope / not claimed
At-rest encryption, signed releases, tamper-proof backups, protection against malware on the device, an
external penetration test, accessibility certification.
