# SEED backup format (`.beacon`, format version 1)

SEED is BEACON's portable, offline backup. It is **not encrypted and not signed**. See ADR-017.

## Layout

```
offset 0   8 bytes   ASCII "BCNSEED1"
offset 8   4 bytes   manifest length N (unsigned, little-endian)
offset 12  N bytes   manifest (UTF-8 JSON)
offset 12+N          entry bytes, concatenated in manifest order
```

Manifest fields: `format` (`"beacon-seed"`), `formatVersion` (`1`), `appVersion`, `schemaVersion`
(database schema, currently 5), `createdAt`, `encrypted: false`, `authenticated: false`, `warning`,
and `entries: [{ path, size, sha256 }]`. Entry offsets are the running sum of `size`.

Allowed entry paths (anything else rejects the package):

- `data/records.json`: `{ "tables": { "<table>": [ { "id": n, ...columns } ] } }` for notes, documents,
  research_collections, research_documents, watchtower_events/sources/claims/hypotheses/links,
  research_source_links and research_excerpts. Values are strings, integers or null.
- `originals/<64 hex sha256>.md|txt`: Archive originals, byte for byte.
- `research_originals/<64 hex sha256>.md|txt|pdf`: Research originals, byte for byte.

## Validation (before anything is written)

Magic and version; manifest size and shape; unsupported `formatVersion` or newer `schemaVersion`
rejected; declared sizes must equal the remaining bytes exactly; every path matched exactly; every
entry's SHA-256 verified; originals must match their content-addressed names, row hashes and byte
lengths; unreferenced files, duplicate paths, unknown tables, wrong fields, dangling references and
oversized packages/rows/entries are rejected. Limits: 64 MiB package, 2 MiB manifest, 32 MiB records,
50,000 rows, 20,002 entries, 1 MiB / 20 MiB per original.

## Restore semantics

Additive and all-or-nothing; nothing existing is changed or deleted. Records already present
(by identity, see ADR-017) are skipped, so restoring twice, or into the library the backup came
from, adds nothing. If you edited a record after exporting, the old version is added next to it.

## What a checksum does and does not tell you

It shows the file arrived unchanged compared with its own manifest. It does not prove who made the
file, and the manifest text itself is not digest-protected. Do not restore packages from sources you
do not trust to be your own, and treat every backup as private.

## Platform notes

- **Windows app:** export downloads the file through the WebView; restore uses a file picker. Native
  save/open behaviour is a manual check (docs/RELEASE-CHECKLIST.md).
- **Browser demo:** same format and workflow against IndexedDB; the demo is capped at 200 Archive
  documents. Restoring into the demo's browser profile only.
- **Android:** see docs/ANDROID.md.
