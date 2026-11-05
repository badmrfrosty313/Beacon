import { invoke } from '@tauri-apps/api/core';

import type { BeaconApi } from './beaconApi';
import { toApiError } from './errors';
import {
  ApiError,
  type AppInfo,
  type ClaimInput,
  type EventInput,
  type EvidenceLink,
  type HypothesisInput,
  type LinkInput,
  type ResearchClaim,
  type ResearchEvent,
  type ResearchHypothesis,
  type ResearchSource,
  type SourceInput,
  type WatchtowerSnapshot,
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
    getWatchtower: () => call<WatchtowerSnapshot>('watchtower_snapshot'),
    createEvent: (input: EventInput) => call<ResearchEvent>('watchtower_create_event', { input }),
    updateEvent: (id, input) => call<ResearchEvent>('watchtower_update_event', { id, input }),
    createSource: (input: SourceInput) =>
      call<ResearchSource>('watchtower_create_source', { input }),
    updateSource: (id, input) => call<ResearchSource>('watchtower_update_source', { id, input }),
    createClaim: (input: ClaimInput) => call<ResearchClaim>('watchtower_create_claim', { input }),
    createHypothesis: (input: HypothesisInput) =>
      call<ResearchHypothesis>('watchtower_create_hypothesis', { input }),
    updateHypothesis: (id, input) =>
      call<ResearchHypothesis>('watchtower_update_hypothesis', { id, input }),
    createEvidenceLink: (input: LinkInput) =>
      call<EvidenceLink>('watchtower_create_link', { input }),
  };
}
