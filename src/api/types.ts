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
