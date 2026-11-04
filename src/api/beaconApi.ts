import type {
  AppInfo,
  Document,
  DocumentSummary,
  ImportDocument,
  LookupResult,
  NewNote,
  Note,
  NoteSummary,
  ScriptureOverview,
  ScripturePassage,
  SearchHit,
} from './types';

/**
 * Everything the UI may ask of the backend. Components depend on this interface only, never on
 * Tauri, so they can be tested with an in-memory fake and the storage layer can change freely.
 */
export interface BeaconApi {
  getAppInfo(): Promise<AppInfo>;
  listNotes(): Promise<NoteSummary[]>;
  getNote(id: number): Promise<Note>;
  createNote(input: NewNote): Promise<Note>;
  importDocument(input: ImportDocument): Promise<Document>;
  listDocuments(): Promise<DocumentSummary[]>;
  getDocument(id: number): Promise<Document>;
  searchDocuments(query: string): Promise<SearchHit[]>;
  /** Translation details and the list of books. Read-only reference data. */
  getScriptureOverview(): Promise<ScriptureOverview>;
  /** Resolve a typed reference such as "Rev 13:16-18". Bad input yields `{ ok: false }`. */
  lookupScripture(input: string): Promise<LookupResult>;
  /** A whole chapter by book id ("REV") and chapter number. Rejects with `not_found` if absent. */
  getScriptureChapter(bookId: string, chapter: number): Promise<ScripturePassage>;
}
