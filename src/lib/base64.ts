const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard RFC 4648 base64 with padding. Used only to move file bytes across Tauri IPC. */
export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  const CHUNK = 3 * 4096;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    let out = '';
    const end = Math.min(offset + CHUNK, bytes.length);
    for (let i = offset; i < end; i += 3) {
      const b0 = bytes[i] ?? 0;
      const b1 = i + 1 < bytes.length ? (bytes[i + 1] ?? 0) : 0;
      const b2 = i + 2 < bytes.length ? (bytes[i + 2] ?? 0) : 0;
      const n = (b0 << 16) | (b1 << 8) | b2;
      out += ALPHABET[(n >> 18) & 63];
      out += ALPHABET[(n >> 12) & 63];
      out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
      out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
    }
    parts.push(out);
  }
  return parts.join('');
}
