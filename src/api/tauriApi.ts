import { invoke } from '@tauri-apps/api/core';

import type { BeaconApi } from './beaconApi';
import { toApiError } from './errors';
import { base64ToBytes, bytesToBase64 } from '../lib/base64';
import { MAX_PACKAGE_BYTES as SEED_MAX_BYTES } from '../lib/seed/format';
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
  type DuplicateCheck,
  type ImportedDocument,
  type ImportedExcerpt,
  type ImportedHit,
  type ImportedLinks,
  type ImportedSourceLink,
  type ImportedSummary,
  type ResearchCollection,
  type Document,
  type DocumentSummary,
  type LookupResult,
  type Note,
  type NoteSummary,
  type ScriptureOverview,
  type ScripturePassage,
  type SearchHit,
  type SeedExport,
  type SeedPreview,
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
    listResearchCollections: () => call<ResearchCollection[]>('research_list_collections'),
    createResearchCollection: (input) =>
      call<ResearchCollection>('research_create_collection', { input }),
    checkResearchDuplicate: (sha256) =>
      call<DuplicateCheck>('research_check_duplicate', { sha256 }),
    importResearch: ({ bytes, ...rest }) =>
      call<ImportedDocument>('research_import', {
        input: { ...rest, data: bytesToBase64(bytes) },
      }),
    listResearch: (collectionId) =>
      call<ImportedSummary[]>('research_list', { collectionId: collectionId ?? null }),
    getResearch: (id) => call<ImportedDocument>('research_get', { id }),
    searchResearch: (query, collectionId) =>
      call<ImportedHit[]>('research_search', { query, collectionId: collectionId ?? null }),
    updateResearchMetadata: (id, input) =>
      call<ImportedSummary>('research_update_metadata', { id, input }),
    getResearchLinks: () => call<ImportedLinks>('research_links'),
    linkResearchSource: (documentId, sourceId) =>
      call<ImportedSourceLink>('research_link_source', { documentId, sourceId }),
    linkResearchExcerpt: (documentId, claimId, location) =>
      call<ImportedExcerpt>('research_link_excerpt', {
        documentId,
        claimId,
        location: location ?? null,
      }),
    exportSeed: async () => {
      const { data, ...rest } = await call<Omit<SeedExport, 'bytes'> & { data: string }>(
        'seed_export',
      );
      const bytes = base64ToBytes(data, SEED_MAX_BYTES);
      if (bytes === null) throw new ApiError('internal', 'The backup could not be read back.');
      return { ...rest, bytes };
    },
    inspectSeed: (bytes) => call<SeedPreview>('seed_inspect', { data: bytesToBase64(bytes) }),
    restoreSeed: (bytes, confirmSha256) =>
      call<SeedPreview>('seed_restore', { data: bytesToBase64(bytes), confirmSha256 }),
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
