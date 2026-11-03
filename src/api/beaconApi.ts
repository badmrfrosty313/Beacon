import type {
  AppInfo,
  Document,
  DocumentSummary,
  ImportDocument,
  NewNote,
  Note,
  NoteSummary,
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
}
