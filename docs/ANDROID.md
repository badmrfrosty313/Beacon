# BEACON on Android (Sprint 007 / B-019)

Same Tauri 2 app, same Rust core and SQLite database, same React UI. No account, cloud service,
telemetry or AI. The `INTERNET` permission is **removed** from the generated manifest (the CI build
fails if it reappears); the app requests no storage permissions.

## What is built and how

`.github/workflows/android.yml` (Ubuntu):

1. `npx tauri android init --ci` generates `src-tauri/gen/android` (not committed).
2. The `INTERNET` permission line is deleted from `AndroidManifest.xml` and the build asserts it is gone.
3. **apk job:** release APK for `aarch64` (arm64), zip-aligned and signed with a **throwaway key created on the
   runner**. The result is installable for testing. It is **not** a distribution signature, cannot update an
   install signed with a different key, and is not suitable for the Play Store. Uploaded as artifact
   `beacon-android-arm64-test-signed` with `permissions.txt` and `SHA256SUMS.txt`.
4. **emulator job:** debug APK for `x86_64`, installed on an API 34 emulator (`scripts/android-smoke.sh`): it must
   launch, stay alive, create `beacon.db` in app-private storage, and hold no `INTERNET` permission. Screenshot
   and logcat are uploaded as artifact `android-emulator-evidence`.

## Validation status (be precise)

| Claim | Status |
| --- | --- |
| Rust core cross-compiles for Android; APK builds | **CI-verified** (Android workflow) |
| App launches on an x86_64 **emulator**, creates its SQLite database, requests no INTERNET | **CI-verified** (emulator smoke) |
| Archive/Scripture/Watchtower/Research/SEED workflows on a **physical device** | **PENDING: hardware gate not passed** |
| Airplane-mode cold start on a physical device | **PENDING** |
| File picker import, PDF import and SEED restore on Android | **PENDING** (device) |
| SEED **export** (file download) on Android | **PENDING and a known risk** (see below) |

Nobody has run BEACON on a physical Android device. Do not describe Android as validated.

## Known Android risks and limitations

- **Export download.** SEED export offers a Blob download from the WebView. Desktop WebView2 and browsers handle this;
  the Android System WebView embedded by Tauri may **ignore** it. If the device acceptance test fails at step 8,
  the planned fix is the official dialog and fs plugins (a save dialog returning a content URI), which needs new
  dependencies, capability entries and an ADR. Until then, treat Android as restore-capable and export as unverified.
- Restore uses `<input type=file>`; Tauri's Android WebView supports the system file chooser, but this is unconfirmed
  on hardware.
- PDF import runs pdf.js in the WebView; large PDFs can be slow or exhaust memory on low-end phones (limits: 20 MiB
  file, 3,000,000 characters of text).
- arm64 only. 32-bit ARM and x86 devices are not built. Minimum Android version is Tauri's default (API 24).
- App data is private to the app and unencrypted; uninstalling the app deletes it. Back up with SEED first.

## Device acceptance checklist (owner, physical Android device)

Install `beacon-first-light-arm64-TEST-SIGNED.apk` (allow installs from your file manager or `adb install`). Record
device model, Android version and pass/fail per step. Use synthetic data only.

1. Turn on airplane mode, then cold-start the app (swipe it away first). It opens without any network prompt.
2. Settings shows a data location and schema version 5.
3. Create a note, close the app completely, reopen: the note is still there.
4. Archive: import a small `.md` file with the system file chooser; open it; search for a word in it.
5. Scripture: look up `John 3:16`; open a chapter; create a note from a reference.
6. Research: create a collection, import a small `.txt` and a small text PDF; open the PDF text.
7. Watchtower: create an event, a source (link it to the archive document), a claim and a hypothesis; link evidence.
8. Settings, **Create backup**: confirm a `.beacon` file can be saved somewhere you can find it. (Known risk.)
9. Restore that file after clearing app data or on a second device: preview shows the expected new records,
   confirm, and every record, link and original is present; restoring again adds nothing.
10. Layout: rotate the phone; navigation, forms and tables are usable at phone width with no sideways page scroll.
11. Settings → Apps → BEACON → Permissions: none requested. Network access is not listed.
12. Uninstall warning understood (data is deleted with the app).
