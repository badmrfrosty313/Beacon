/**
 * Client-side mirror of src-tauri/src/notes/validation.rs, used only for fast feedback.
 * The Rust backend is authoritative and re-validates every request; keep these limits in sync.
 */

/** Counted in Unicode code points (matches Rust `chars().count()` and SQLite `length()`). */
export const MAX_TITLE_CHARS = 200;
/** Counted in UTF-8 bytes. */
export const MAX_BODY_BYTES = 100_000;

export interface NoteFieldErrors {
  title?: string;
  body?: string;
}

const CONTROL_CHAR = /\p{Cc}/u;
const ALLOWED_BODY_CONTROL = new Set(['\n', '\r', '\t']);

export function countCodePoints(text: string): number {
  return Array.from(text).length;
}

export function countUtf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Returns an empty object when the input is acceptable. */
export function validateNote(title: string, body: string): NoteFieldErrors {
  const errors: NoteFieldErrors = {};

  const trimmedTitle = title.trim();
  if (trimmedTitle.length === 0) {
    errors.title = 'A title is required.';
  } else if (countCodePoints(trimmedTitle) > MAX_TITLE_CHARS) {
    errors.title = `The title must be at most ${MAX_TITLE_CHARS} characters.`;
  } else if (CONTROL_CHAR.test(trimmedTitle)) {
    errors.title = 'The title must not contain control characters.';
  }

  if (countUtf8Bytes(body) > MAX_BODY_BYTES) {
    errors.body = `The note must be at most ${MAX_BODY_BYTES.toLocaleString('en-US')} bytes.`;
  } else if (Array.from(body).some((c) => CONTROL_CHAR.test(c) && !ALLOWED_BODY_CONTROL.has(c))) {
    errors.body = 'The note must not contain control characters other than line breaks and tabs.';
  }

  return errors;
}
