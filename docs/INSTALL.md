# Install, upgrade and recovery (v0.1 First Light release candidate)

Builds are **unsigned (Windows) or test-signed (Android)** and are not distribution releases. Verify the
published SHA-256 only to detect a damaged download; it does not prove who built the file.

## Windows
1. Download the CI artifact `beacon-windows-test-exe` (EXE plus `SHA256SUMS.txt`) from the PR's Windows CI run.
   Compare `Get-FileHash beacon.exe -Algorithm SHA256` with the checksum file.
2. Run `beacon.exe`. Windows SmartScreen will warn because the file is unsigned. This is not an installer.
3. Data lives in `%APPDATA%\org.projectbeacon.desktop` (Settings shows the exact path).

## Android
See [ANDROID.md](ANDROID.md): install the test-signed arm64 APK, allow installs from your file manager, then run the device checklist.

## Upgrade
Open a newer build over existing data. Migrations are forward-only and run at startup; the Rust tests upgrade a
database from every earlier schema version and check that notes, documents, Watchtower and research data survive.
**Before upgrading, create a SEED backup** (Settings → Create backup). There is no downgrade: an older build cannot
open a database written by a newer one.

## Back up and move to another installation
1. Settings → *Create backup* → keep the `.beacon` file private (it is not encrypted).
2. On the other installation: Settings → choose the file → read the preview → *Add N new records*.
3. Restoring only adds. Restore twice and the second restore adds nothing.

## Recovery and troubleshooting
- **"Invalid SEED package" / rejected backup:** the file is damaged, altered, from a newer BEACON, or not a backup.
  Nothing was changed. Try another copy of the backup.
- **Export says an original is missing or damaged:** re-import that file, then export again. Opening a document
  re-verifies its original and reports damage; re-importing the same file repairs it.
- **App says the database is unavailable:** Settings shows the error. Close the app and copy the data folder aside
  before trying anything else. Do not delete `beacon.db-wal` separately from `beacon.db`.
- **Start from scratch:** close BEACON and delete the data folder (this erases everything; back up first).
- **Scripture unavailable:** the reader shows a message; notes, archive and research keep working. Reinstalling the
  same build restores the packaged text.
- **Large PDF import is slow or fails:** limits are 20 MiB and 3,000,000 characters of text; scanned (image-only)
  PDFs have no text and cannot be imported.
