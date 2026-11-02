import type { AppInfo, NewNote, Note, NoteSummary } from './types';

/**
 * Everything the UI may ask of the backend. Components depend on this interface only, never on
 * Tauri, so they can be tested with an in-memory fake and the storage layer can change freely.
 */
export interface BeaconApi {
  getAppInfo(): Promise<AppInfo>;
  listNotes(): Promise<NoteSummary[]>;
  getNote(id: number): Promise<Note>;
  createNote(input: NewNote): Promise<Note>;
}
