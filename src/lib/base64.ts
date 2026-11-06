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

/**
 * Strict standard base64 decoder (padding required, no whitespace). Returns `null` for anything
 * malformed or longer than `maxBytes` once decoded.
 */
export function base64ToBytes(text: string, maxBytes: number): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const length = (text.length / 4) * 3 - padding;
  if (length > maxBytes) return null;
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j += 1) {
      const ch = text[i + j] as string;
      let v: number;
      if (ch === '=') {
        if (i + 4 !== text.length || j < 4 - padding) return null;
        v = 0;
      } else {
        v = ALPHABET.indexOf(ch);
        if (v < 0) return null;
      }
      n = (n << 6) | v;
    }
    if (o < length) out[o++] = (n >> 16) & 255;
    if (o < length) out[o++] = (n >> 8) & 255;
    if (o < length) out[o++] = n & 255;
  }
  return out;
}
