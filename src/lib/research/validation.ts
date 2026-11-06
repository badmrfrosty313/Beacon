/**
 * Validation for research import: the TypeScript mirror of src-tauri/src/research/validation.rs.
 * The desktop app validates in Rust; the browser demo uses this. Messages never echo input.
 */
import { ApiError } from '../../api/types';
import type { ImportedFormat } from '../../api/types';

export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
export const MAX_FILENAME_BYTES = 255;
export const MAX_TITLE_CHARS = 200;
export const MAX_COLLECTION_NAME_CHARS = 100;
export const MAX_COLLECTION_DESCRIPTION_CHARS = 1000;
export const MAX_NOTE_CHARS = 1000;
export const MAX_LOCATION_CHARS = 100;
export const MAX_EXTRACTED_CHARS = 3_000_000;
export const MAX_PAGES = 100_000;
export const MAX_EXTRACTION_METHOD_CHARS = 100;
export const MAX_DOCUMENTS = 2000;
export const MAX_COLLECTIONS = 200;
export const MAX_LINKS = 5000;
const PDF_HEADER_WINDOW = 1024;

const UNSAFE_NAME_CHARS = new RegExp(
  '[\\p{Cc}\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF]',
  'u',
);

const fail = (message: string): never => {
  throw new ApiError('validation', message);
};

const chars = (text: string): number => Array.from(text).length;

export function validateFilename(name: string): { title: string; format: ImportedFormat } {
  if (
    !name ||
    new TextEncoder().encode(name).length > MAX_FILENAME_BYTES ||
    UNSAFE_NAME_CHARS.test(name) ||
    /[\\/:]/u.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    return fail('Choose a .pdf, .md or .txt file with a plain filename.');
  }
  const unsupported = 'Only PDF (.pdf), Markdown (.md) and text (.txt) files can be imported.';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return fail(unsupported);
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext !== 'pdf' && ext !== 'md' && ext !== 'txt') return fail(unsupported);
  const title = name.slice(0, dot).trim();
  if (!title || chars(title) > MAX_TITLE_CHARS) {
    return fail('The filename must contain a title of 1–200 characters.');
  }
  return { title, format: ext };
}

export function validatePdfHeader(bytes: Uint8Array): void {
  const window = bytes.subarray(0, PDF_HEADER_WINDOW);
  for (let i = 0; i + 5 <= window.length; i += 1) {
    if (
      window[i] === 0x25 &&
      window[i + 1] === 0x50 &&
      window[i + 2] === 0x44 &&
      window[i + 3] === 0x46 &&
      window[i + 4] === 0x2d
    ) {
      return;
    }
  }
  fail('That file does not look like a PDF.');
}

export function validateExtractedText(text: string): void {
  if (text.trim() === '') {
    fail('No text could be read from this PDF. It may be a scanned image; BEACON does not do OCR.');
  }
  if (chars(text) > MAX_EXTRACTED_CHARS) fail('The extracted text is too long.');
  if (/\p{Cc}/u.test(text.replace(/[\t\n\r]/gu, ''))) {
    fail('The extracted text contains unsupported control characters.');
  }
}

export function validateExtractionMethod(method: string): void {
  if (
    method === '' ||
    chars(method) > MAX_EXTRACTION_METHOD_CHARS ||
    !/^[A-Za-z0-9 ._:+()-]+$/.test(method)
  ) {
    fail('The extraction method label is not valid.');
  }
}

export function validatePageCount(pages: number): void {
  if (!Number.isInteger(pages) || pages < 1 || pages > MAX_PAGES) {
    fail('The page count is not valid.');
  }
}

export function validateCollectionName(name: string): string {
  const text = name.trim();
  if (text === '') return fail('The collection name is required.');
  if (chars(text) > MAX_COLLECTION_NAME_CHARS) {
    return fail('The collection name must be at most 100 characters.');
  }
  if (UNSAFE_NAME_CHARS.test(text)) {
    return fail('The collection name must not contain control characters.');
  }
  return text;
}

export function validateLocation(location: string | null | undefined): string | null {
  const text = (location ?? '').trim();
  if (text === '') return null;
  if (chars(text) > MAX_LOCATION_CHARS) return fail('The location must be at most 100 characters.');
  if (/\p{Cc}/u.test(text)) return fail('The location must not contain control characters.');
  return text;
}

export function validateSha256(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) fail('That checksum is not valid.');
}
