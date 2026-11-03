import { ApiError } from '../api/types';

export const MAX_DOCUMENT_BYTES = 1_048_576;

/** Client-side feedback only; the native Rust importer independently validates everything. */
export function validateDocument(
  name: string,
  bytes: readonly number[],
): { title: string; format: string; body: string } {
  if (!name || /[\\/:\x00-\x1f\x7f]/u.test(name) || name === '.' || name === '..') {
    throw new ApiError('validation', 'Choose a .md or .txt file with a plain filename.');
  }
  const dot = name.lastIndexOf('.');
  if (dot < 1) {
    throw new ApiError('validation', 'Only Markdown (.md) and text (.txt) files can be imported.');
  }
  const title = name.slice(0, dot).trim();
  const format = name.slice(dot + 1).toLowerCase();
  if (format !== 'txt' && format !== 'md') {
    throw new ApiError('validation', 'Only Markdown (.md) and text (.txt) files can be imported.');
  }
  if (!title || Array.from(title).length > 200) {
    throw new ApiError('validation', 'The filename must contain a title of 1–200 characters.');
  }
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new ApiError('validation', 'Files must be at most 1 MiB.');
  }
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new ApiError('validation', 'The file contains invalid bytes.');
  }
  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    throw new ApiError('validation', 'The selected file is not valid UTF-8 text.');
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(body)) {
    throw new ApiError('validation', 'The file contains unsupported control characters.');
  }
  return { title, format, body: body.replace(/^\uFEFF/u, '') };
}
