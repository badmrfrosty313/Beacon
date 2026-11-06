#!/usr/bin/env bash
# Emulator smoke test: install the debug APK, start BEACON, and confirm it stays alive and created
# its SQLite database. Evidence goes to smoke-out/. This is an EMULATOR check, not a device test.
set -u
PKG=org.projectbeacon.desktop
OUT=smoke-out
mkdir -p "$OUT"
APK=$(find src-tauri/gen/android -name '*debug.apk' | head -n1)
echo "APK: $APK" | tee "$OUT/summary.txt"
adb install -r "$APK" || { echo "FAIL: install" | tee -a "$OUT/summary.txt"; exit 1; }
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 25
adb exec-out screencap -p > "$OUT/screen.png" || true
adb logcat -d > "$OUT/logcat.txt" 2>&1 || true
PID=$(adb shell pidof "$PKG" | tr -d '\r')
echo "pid: ${PID:-none}" | tee -a "$OUT/summary.txt"
adb shell run-as "$PKG" find . -name 'beacon.db*' 2>&1 | tee "$OUT/db-files.txt"
if [ -z "$PID" ]; then echo "FAIL: app not running" | tee -a "$OUT/summary.txt"; grep -i "FATAL\|beacon\|panick" "$OUT/logcat.txt" | tail -40; exit 1; fi
if ! grep -q "beacon.db" "$OUT/db-files.txt"; then echo "FAIL: database file not created" | tee -a "$OUT/summary.txt"; exit 1; fi
adb shell dumpsys package "$PKG" | grep -i "permission" | tee "$OUT/permissions.txt"
if grep -q "android.permission.INTERNET" "$OUT/permissions.txt"; then echo "FAIL: INTERNET permission present" | tee -a "$OUT/summary.txt"; exit 1; fi
echo "PASS: emulator smoke (launch, alive, database created, no INTERNET)" | tee -a "$OUT/summary.txt"
