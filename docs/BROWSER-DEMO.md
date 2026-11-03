# Browser Harness: Developer Preview

> **Not the production desktop app.** Preview uses a browser-only IndexedDB store.
> It does not run Rust, Tauri IPC or native SQLite. Do not store confidential content here.

## Why

Provide a fast interface preview that is accessible by URL without downloading a desktop
binary after every layout change. It exercises React navigation, form behavior and a local
browser storage adapter, not the native application's offline/restart guarantees.

## Local run

```powershell
npm install
npm run dev:demo
```

For a static preview:

```powershell
npm run build:demo
npm run preview
```

The production `npm run dev` still uses the native Tauri adapter. Without Tauri IPC it will
fail explicitly, rather than silently switching to the demo store.

## Hosted preview

The `Browser Demo` GitHub Actions workflow builds and tests PRs, and deploys `main` to
GitHub Pages when Pages is enabled for Actions in repo settings.

Expected URL after successful deployment:
`https://badmrfrosty313.github.io/Beacon/`

If the URL returns a 404, check repository Settings → Pages, select **GitHub Actions** as
the build/deploy source, and check the latest **Browser Demo** workflow's publish job.
Do not claim publication until it succeeds.

## Storage and security boundaries

- Browser demo notes are persisted in this browser's IndexedDB under the Pages origin.
- Unencrypted, no backup, no export or cross-device synchronization.
- Deleting site data or using another browser loses access to the demo notes.
- Opening the hosted page downloads static files from GitHub Pages. No notes are sent
  to BEACON servers, and no API calls or telemetry are implemented.
- The demo indicator must remain visible in all modules.
- A real native build still needs Windows launch, Tauri IPC, SQLite persistence
  across restart, and airplane-mode manual verification.

## Manual browser smoke

1. Open the demo. Verify the **BROWSER DEMO** warning appears.
2. Create a dummy note, confirm that it displays.
3. Reload the page. Confirm that the note is still in the Archive list.
4. Switch between modules and return; confirm notes persist.
5. Disable network after the page is already loaded. Don't assume offline cold-start
   or reload without service worker caching (not part of this preview).
6. Open Settings and verify it states **Browser IndexedDB** instead of SQLite.

### Documents in the browser demo (Sprint 002)

7. Archive → Documents → **Import documents**; choose a `.md` or `.txt` file (UTF-8, up to 1 MiB).
   It should be listed and open in the reader with file name, format, size, time and SHA-256.
8. Search for a word, then for `"an exact phrase"` from the file. The note under the search box must
   say this is a browser word scan and **not** SQLite FTS5. Click a result to open it.
9. Import the same file again: expect "already in your library".
10. Reload the page: the documents and search still work. Existing notes from earlier demo
    versions are kept (the IndexedDB schema upgrades from version 1 to 2 in place).

The demo stores the original bytes and a SHA-256 in IndexedDB and re-verifies the hash when a
document is opened. It holds at most 200 documents, and its data is separate from the desktop
app's SQLite database. **Do not import confidential files into the hosted demo.**

Record these checks as browser-only, not native verification.
