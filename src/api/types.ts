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
