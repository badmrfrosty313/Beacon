# Release checklist: v0.1 First Light

Validation levels: **CI** = automated GitHub Actions run; **Browser** = hosted/dev demo in a browser;
**Native** = a person ran the Windows app; **Device** = a person ran a physical Android device.
Status is recorded only after it actually happened. Use synthetic data only.

## Automated (CI-verified; see release notes for run links)
- Prettier, ESLint, `tsc` strict, Vitest (26+ files), `cargo fmt`, `cargo test --locked`, Clippy `-D warnings`,
  Scripture source verification, Windows release build, desktop-bundle check, browser-demo build.
- Android: arm64 release APK build, emulator launch, SQLite creation, no INTERNET permission.

## Owner acceptance (one end-to-end pass; Windows first, then Android)
1. **Cold start offline.** Disconnect Wi-Fi (airplane mode on Android). Launch. No network prompts. (Native, Device)
2. **Create research.** Research → new collection → import a small `.md` and a small text PDF. Open each; the text
   appears; the hash is shown.
3. **Link evidence.** Map a document into Watchtower: create a source, record an excerpt as a claim you classify,
   create a hypothesis, link the claim as *supports* with a reason.
4. **Scripture.** Look up `Revelation 13:18`; create a note from the reference; follow it back.
5. **Persist.** Close and reopen. Everything from steps 2 to 4 is still there.
6. **Export SEED.** Settings → Create backup. Note the file name and SHA-256 shown. Read the "not encrypted" warning.
7. **Restore elsewhere.** On a second installation (second Windows profile, the browser demo, or Android) choose the
   `.beacon` file. The preview lists the expected records; confirm. Open the document, claim, link and excerpt:
   all present. Open a document (its original is re-verified).
8. **Repeat restore.** Restore the same file again: the preview says 0 new; nothing duplicates.
9. **Reject a bad backup.** Copy the file, change one byte in a hex editor, try to restore it: rejected with a
   message, and the library is unchanged.
10. **Offline again.** Repeat step 1 on the restored installation and confirm it works with no network.
11. **Android:** run the device checklist in [ANDROID.md](ANDROID.md), including whether a backup can be saved (known risk).
12. **Windows download behaviour:** step 6 produces a file in your Downloads folder (not verified in the WebView by CI).

## Known unverified items
Native launch of this release candidate, airplane-mode proof, Windows WebView download, Android physical device
(all workflows), Android export, screen-reader behaviour, and keyboard-only traversal on hardware.
