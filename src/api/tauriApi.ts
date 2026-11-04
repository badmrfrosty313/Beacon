import { invoke } from '@tauri-apps/api/core';

import type { BeaconApi } from './beaconApi';
import { toApiError } from './errors';
import {
  ApiError,
  type AppInfo,
  type Document,
  type DocumentSummary,
  type LookupResult,
  type Note,
  type NoteSummary,
  type ScriptureOverview,
  type ScripturePassage,
  type SearchHit,
} from './types';

/** Minimal shape of Tauri's `invoke`, injectable for tests. */
export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

/** True when running inside the Tauri shell (as opposed to a plain browser tab). */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const guardedInvoke: InvokeFn = <T>(command: string, args?: Record<string, unknown>) => {
  if (!isTauriRuntime()) {
    return Promise.reject(
      new ApiError(
        'backend_unavailable',
        'The BEACON backend is not available. Run the desktop app with "npm run tauri dev".',
      ),
    );
  }
  return invoke<T>(command, args);
};

/**
 * The real backend: each method maps to one `#[tauri::command]` in src-tauri/src/commands.rs.
 * Command names and argument keys here must match the Rust signatures exactly.
 */
export function createTauriApi(invokeFn: InvokeFn = guardedInvoke): BeaconApi {
  async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return await invokeFn<T>(command, args);
    } catch (error) {
      throw toApiError(error);
    }
  }

  return {
    getAppInfo: () => call<AppInfo>('app_info'),
    listNotes: () => call<NoteSummary[]>('list_notes'),
    getNote: (id) => call<Note>('get_note', { id }),
    createNote: ({ title, body }) => call<Note>('create_note', { title, body }),
    importDocument: ({ name, bytes }) => call<Document>('import_document', { name, bytes }),
    listDocuments: () => call<DocumentSummary[]>('list_documents'),
    getDocument: (id) => call<Document>('get_document', { id }),
    searchDocuments: (query) => call<SearchHit[]>('search_documents', { query }),
    getScriptureOverview: () => call<ScriptureOverview>('scripture_overview'),
    lookupScripture: (input) => call<LookupResult>('scripture_lookup', { input }),
    getScriptureChapter: (bookId, chapter) =>
      call<ScripturePassage>('scripture_chapter', { bookId, chapter }),
  };
}
