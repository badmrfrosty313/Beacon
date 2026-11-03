import { ApiError } from '../api/types';

export const MAX_DOCUMENT_BYTES = 1_048_576;
export const MAX_FILENAME_BYTES = 255;
export const MAX_TITLE_CHARS = 200;

const WRONG_TYPE = 'Only Markdown (.md) and text (.txt) files can be imported.';

/** Client-side feedback only; the native Rust importer independently validates everything
 * (`src-tauri/src/documents/validation.rs` is authoritative). */
export function validateFilename(name: string): { title: string; format: 'md' | 'txt' } {
  if (
    !name ||
    new TextEncoder().encode(name).length > MAX_FILENAME_BYTES ||
    // Control characters, plus bidi-override and zero-width characters that disguise names.
    /[\p{Cc}​-‏‪-‮⁠⁦-⁩﻿]/u.test(name) ||
    /[\\/:]/u.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new ApiError('validation', 'Choose a .md or .txt file with a plain filename.');
  }
  const dot = name.lastIndexOf('.');
  if (dot < 0) throw new ApiError('validation', WRONG_TYPE);
  const format = name.slice(dot + 1).toLowerCase();
  if (format !== 'txt' && format !== 'md') throw new ApiError('validation', WRONG_TYPE);
  const title = name.slice(0, dot).trim();
  if (!title || Array.from(title).length > MAX_TITLE_CHARS) {
    throw new ApiError('validation', 'The filename must contain a title of 1–200 characters.');
  }
  return { title, format };
}

/** Decode and validate content; returns the text with one leading BOM removed. */
export function validateContent(bytes: ArrayLike<number>): string {
  if (bytes.length === 0) throw new ApiError('validation', 'The selected file is empty.');
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new ApiError('validation', 'Files must be at most 1 MiB.');
  }
  const array = bytes instanceof Uint8Array ? bytes : Uint8Array.from(Array.from(bytes));
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(array);
  } catch {
    throw new ApiError('validation', 'The selected file is not valid UTF-8 text.');
  }
  // Same rule as Rust's char::is_control (Unicode Cc: C0, DEL, C1) minus \n \r \t.
  if (/\p{Cc}/u.test(body.replace(/[\t\n\r]/gu, ''))) {
    throw new ApiError('validation', 'The file contains unsupported control characters.');
  }
  return body.replace(/^﻿/u, '');
}

export function validateDocument(
  name: string,
  bytes: ArrayLike<number>,
): { title: string; format: 'md' | 'txt'; body: string } {
  const { title, format } = validateFilename(name);
  return { title, format, body: validateContent(bytes) };
}
