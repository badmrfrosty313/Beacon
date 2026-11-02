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

Record these checks as browser-only, not native verification.
