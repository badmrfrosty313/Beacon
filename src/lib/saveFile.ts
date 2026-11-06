/**
 * Offer `bytes` to the user as a download. Entirely local: a Blob URL is created, clicked and
 * revoked. No network request is made. (Behaviour inside the Tauri WebView and on Android is a
 * manual-validation item; see docs/RELEASE-CHECKLIST.md.)
 */
export function downloadBytes(fileName: string, bytes: Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke after the browser has had a chance to start the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
