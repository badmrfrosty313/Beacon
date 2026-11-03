/**
 * Search-query parsing shared by the browser demo and the UI, mirroring
 * `src-tauri/src/documents/query.rs` (which is authoritative for the native app).
 *
 * Input is split into words and "quoted phrases". The native app turns each into a literal
 * FTS5 string (so `OR`, `NOT`, `NEAR`, `*`, `col:` are just text) combined with AND; the
 * browser demo applies the same units with its own, simpler token matching.
 */
export const MAX_QUERY_CHARS = 200;
export const MAX_QUERY_UNITS = 8;
export const MAX_SEARCH_RESULTS = 100;

/** Highlight markers wrapped around matches in snippets (control characters never occur in
 * imported text, so they cannot be confused with document content). */
export const MATCH_START = '\u0001';
export const MATCH_END = '\u0002';

export class QueryRejection extends Error {}

/** Returns the searchable units, or an empty array when there is nothing to search. */
export function parseSearchQuery(raw: string): string[] {
  const query = raw.trim();
  if (Array.from(query).length > MAX_QUERY_CHARS) {
    throw new QueryRejection('Search must be at most 200 characters.');
  }
  if (/\p{Cc}/u.test(query)) {
    throw new QueryRejection('Search must not contain control characters.');
  }
  const units: string[] = [];
  let current = '';
  let inQuote = false;
  const flush = () => {
    const unit = current.trim();
    // Punctuation-only fragments have no searchable tokens and are ignored.
    if (/[\p{L}\p{N}]/u.test(unit)) units.push(unit);
    current = '';
  };
  for (const ch of query) {
    if (ch === '"') {
      flush();
      inQuote = !inQuote;
    } else if (!inQuote && /\s/u.test(ch)) {
      flush();
    } else {
      current += ch;
    }
  }
  flush();
  if (units.length > MAX_QUERY_UNITS) {
    throw new QueryRejection('Use at most 8 words or phrases in one search.');
  }
  return units;
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

/** Split a backend snippet into plain and highlighted parts. Rendered as text nodes only. */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let match = false;
  let buffer = '';
  const push = () => {
    if (buffer) parts.push({ text: buffer.replace(/\s+/gu, ' '), match });
    buffer = '';
  };
  for (const ch of snippet) {
    if (ch === MATCH_START) {
      push();
      match = true;
    } else if (ch === MATCH_END) {
      push();
      match = false;
    } else {
      buffer += ch;
    }
  }
  push();
  return parts;
}
