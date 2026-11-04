/**
 * Remembers where the user was reading so reopening BEACON continues from there. This is a
 * per-device convenience only (browser storage inside the app window); nothing depends on it, so
 * every access is guarded and a failure is silently ignored.
 */
const KEY = 'beacon.scripture.position';

export interface SavedPosition {
  bookId: string;
  chapter: number;
}

export function loadPosition(): SavedPosition | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'object' && value !== null) {
      const { bookId, chapter } = value as { bookId?: unknown; chapter?: unknown };
      if (typeof bookId === 'string' && Number.isInteger(chapter)) {
        return { bookId, chapter: chapter as number };
      }
    }
  } catch {
    // Storage unavailable or corrupt: start from the default.
  }
  return null;
}

export function savePosition(position: SavedPosition): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(position));
  } catch {
    // Not critical.
  }
}
