# Offline verification (task B-003)

BEACON's core promise is that it works with no network. This document defines how that is
checked. There are two layers: an **automated guard** that runs on every `npm test`, and a
**manual airplane-mode procedure** that must be performed on a real Windows machine.

> **Status (November 2, 2026):** automated offline guards pass on Windows CI.
> The owner has also confirmed the downloaded native Windows application launches and that a
> saved note persists after restart ([run 41550072221](https://github.com/badmrfrosty313/Beacon/actions/runs/41550072221)).
> **Airplane-mode testing was not explicitly reported**. The offline acceptance check remains
> open until the network-disconnected scenario below is confirmed.

## 1. Automated guard

Run: `npm test` (the file is `src/test/offlineGuard.test.ts`; `src/App.test.tsx` contains a
runtime check).

It fails if any of the following become true:

| Check                                                                                                                         | Why                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Frontend source uses `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`, CSS `@import`, or contains a remote `http(s)://` URL | No code path may reach the network        |
| `index.html` loads a remote script, stylesheet or font                                                                        | Nothing is fetched at startup             |
| Production CSP allows anything other than `'self'`, `data:` images and Tauri IPC (`ipc:`, `http://ipc.localhost`)             | Even a bug cannot call out                |
| The `main` window capability grants any non-`core:` permission                                                                | No filesystem, shell, HTTP or opener APIs |
| `Cargo.toml` or `package.json` gains a dependency that is not on the reviewed allowlist                                       | Networking crates need a deliberate review |
| Rust sources register a Tauri plugin or reference sockets/HTTP clients                                                        | Same                                      |
| The running UI calls `fetch` / `XMLHttpRequest` / `WebSocket` / `EventSource` / `sendBeacon` while navigating and saving     | Runtime proof for the exercised flows     |

`npm run lint` additionally bans those network globals in application code
(`no-restricted-globals` in `eslint.config.js`).

**Limits of the guard:** it is a static and jsdom-level check. It cannot see network traffic
from the operating system, the WebView2 runtime itself, or the installer. That is what the
manual procedure is for.

If the guard fails because you _intentionally_ added a dependency or permission, that is a
security-relevant decision: record it in `DECISIONS.md`, get the owner's approval, and only then
update the allowlist in the test.

## 2. Manual airplane-mode procedure (Windows 10/11)

Goal: show that a cold start, navigation, note creation and a restart all work with no network.

1. Build a release binary: `npm run tauri build -- --no-bundle`
   (output: `src-tauri\target\release\beacon.exe`). Alternatively use the installer from
   `npm run tauri build`.
2. **Remove the data directory** so the run is a true first launch:
   close BEACON, then delete `%APPDATA%\org.projectbeacon.desktop`.
3. **Go offline:** turn on Windows _Airplane mode_ and unplug Ethernet. Confirm offline by
   opening a browser to any site (it must fail).
4. Launch BEACON (`beacon.exe`).
   - Expected: the window opens to **Archive** within a few seconds. No sign-in, no error
     dialog, no "check your connection" message.
5. Click **Watchtower**, **Lifeline**, **Settings**, **Archive**.
   - Expected: Watchtower and Lifeline show "Not implemented yet". Settings shows a version,
     "Database schema: Version 1" and the data location above. No error banners.
6. In **Archive**, click **New note**, enter a title and some text, click **Save note**.
   - Expected: the note appears in the list and is displayed with its line breaks.
7. Try to save with an empty title.
   - Expected: an inline "A title is required." message and nothing saved.
8. **Restart:** close BEACON completely (check Task Manager that `beacon.exe` has exited), then
   launch it again, still offline.
   - Expected: the note is still listed and opens with the same title and text.
9. Optional traffic check: with a tool such as Resource Monitor (Network tab) or Wireshark on a
   machine that _is_ online, launch BEACON and confirm `beacon.exe` and its
   `msedgewebview2.exe` children open no connections to external hosts while you use the app.
10. Optional corruption check: close BEACON, replace the first bytes of
    `%APPDATA%\org.projectbeacon.desktop\beacon.db` with garbage (work on a copy), launch BEACON.
    - Expected: the app still opens, and Archive/Settings show a clear "could not open its local
      database" message instead of crashing.

### Documents addendum (Sprint 002)

With the network still disabled, also do the following and record it in the results table:

- Import one `.md` and one `.txt` file with **Import documents** (the file picker is a local OS
  dialog; no network is involved).
- Search for a word and for a quoted phrase from each file; open a result and check the SHA-256.
- Close BEACON completely, relaunch it still offline, and confirm the documents are listed and
  searchable.

Restore your network afterwards.

## 3. Results log

Add a row each time the manual procedure is performed.

| Date | Tester | OS build | BEACON commit | Steps 1-8 pass? | Notes |
| ---- | ------ | -------- | ------------- | --------------- | ----- |
| 2026-11-02 | Owner | Windows (build unspecified) | `a5f0766` | **Partial / offline unconfirmed** | Native EXE launched; user confirmed save persisted across app restart. Did not explicitly report airplane mode, clean data-dir launch, navigation and validation steps. |
