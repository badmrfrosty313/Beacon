/** Shapes returned by the Rust backend. Keep in sync with src-tauri/src/{notes,state}.rs. */

export interface NoteSummary {
  id: number;
  title: string;
  /** ISO-8601 UTC timestamp, e.g. 2026-11-02T16:45:10.123Z */
  createdAt: string;
}

export interface Note extends NoteSummary {
  body: string;
}

export interface NewNote {
  title: string;
  body: string;
}

/** Metadata for a preserved Markdown or text original (the body is never in list payloads). */
export interface DocumentSummary {
  id: number;
  title: string;
  originalName: string;
  format: string;
  sha256: string;
  byteLength: number;
  importedAt: string;
}

export interface Document extends DocumentSummary {
  body: string;
}

export interface ImportDocument {
  name: string;
  bytes: number[];
}

export interface SearchHit {
  id: number;
  title: string;
  format: string;
  snippet: string;
  importedAt: string;
}

export interface AppInfo {
  appVersion: string;
  dataDir: string;
  /** null when the database could not be opened */
  schemaVersion: number | null;
  databaseError: string | null;
}

/** Read-only Scripture reference data. Mirrors src-tauri/src/scripture/mod.rs. */

export interface TranslationInfo {
  id: string;
  /** Short identifier shown next to every passage, e.g. "WEB". */
  abbreviation: string;
  name: string;
  edition: string;
  language: string;
  licenseStatus: string;
  licenseNotice: string;
  sourceUrl: string;
  sourceSha256: string;
  retrievedOn: string;
  verseCount: number;
}

export interface BookSummary {
  /** USFM book id, e.g. "REV" or "1JN". */
  id: string;
  name: string;
  /** Name used in citations; differs from `name` for Psalms ("Psalm"). */
  citationName: string;
  testament: 'OT' | 'NT';
  order: number;
  chapterCount: number;
}

export interface ScriptureOverview {
  translation: TranslationInfo;
  books: BookSummary[];
}

export interface ScriptureVerse {
  chapter: number;
  verse: number;
  /** Empty only for verses the source provides as a number plus a footnote. */
  text: string;
}

export interface PassageChapter {
  chapter: number;
  verseCount: number;
  /** Psalm title, shown separately from the numbered verses; "" when there is none. */
  superscription: string;
}

export interface NavTarget {
  bookId: string;
  bookName: string;
  chapter: number;
  label: string;
}

export interface ScripturePassage {
  translationId: string;
  translationAbbreviation: string;
  bookId: string;
  bookName: string;
  citationName: string;
  bookChapterCount: number;
  /** Canonical, re-parseable citation, e.g. "Revelation 13:16-18". */
  canonical: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  verses: ScriptureVerse[];
  /** One entry per chapter the passage touches. */
  chapters: PassageChapter[];
  previous: NavTarget | null;
  next: NavTarget | null;
}

export interface ReferenceProblem {
  code: string;
  message: string;
}

/** An unusable reference is an expected outcome, reported as data rather than an error. */
export type LookupResult =
  { ok: true; passage: ScripturePassage } | { ok: false; problem: ReferenceProblem };

export type ApiErrorCode =
  | 'validation'
  | 'not_found'
  | 'database'
  | 'io'
  | 'migration'
  | 'unavailable'
  | 'internal'
  | 'integrity'
  /** The same bytes were already imported; nothing was changed (or a lost original restored). */
  | 'duplicate'
  /** The packaged Scripture text could not be installed or verified; notes are unaffected. */
  | 'scripture_unavailable'
  /** The page is running outside the Tauri desktop shell (e.g. a plain browser). */
  | 'backend_unavailable'
  | 'unknown';

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}
