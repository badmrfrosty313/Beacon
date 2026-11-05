/**
 * Private research import over IndexedDB, for the hosted browser demo ONLY. Same rules as the
 * Rust backend (src-tauri/src/research): originals kept byte for byte with their SHA-256,
 * derivative text, duplicate detection, explicit Watchtower mapping links. Each write is a
 * single IndexedDB transaction. Data never leaves this browser profile; native builds never
 * use this code. PDF text is extracted by the app (see lib/research/extract.ts) and supplied
 * in the import, exactly as on desktop.
 */
import type { BeaconApi } from './beaconApi';
import type { RunTransaction } from './browserWatchtower';
import {
  ApiError,
  type DuplicateCheck,
  type ImportedDocument,
  type ImportedExcerpt,
  type ImportedHit,
  type ImportedLinks,
  type ImportedSourceLink,
  type ImportedSummary,
  type ResearchCollection,
} from './types';
import { MAX_SEARCH_RESULTS, QueryRejection, parseSearchQuery } from '../lib/searchQuery';
import { sha256Hex } from '../lib/sha256';
import { matchDocument, tokenize } from '../lib/wordSearch';
import { validateContent } from '../lib/documentValidation';
import {
  MAX_COLLECTIONS,
  MAX_COLLECTION_DESCRIPTION_CHARS,
  MAX_DOCUMENTS,
  MAX_LINKS,
  MAX_NOTE_CHARS,
  MAX_ORIGINAL_BYTES,
  validateCollectionName,
  validateExtractedText,
  validateExtractionMethod,
  validateFilename,
  validateLocation,
  validatePageCount,
  validatePdfHeader,
  validateSha256,
} from '../lib/research/validation';
import {
  ValidationFailure,
  optionalCalendarDate,
  optionalLine,
  optionalText,
  requiredLine,
} from '../lib/watchtower/validation';

export const RESEARCH_STORES = {
  collections: 'rs_collections',
  documents: 'rs_documents',
  sourceLinks: 'rs_source_links',
  excerpts: 'rs_excerpts',
} as const;

type ResearchApi = Pick<
  BeaconApi,
  | 'listResearchCollections'
  | 'createResearchCollection'
  | 'checkResearchDuplicate'
  | 'importResearch'
  | 'listResearch'
  | 'getResearch'
  | 'searchResearch'
  | 'updateResearchMetadata'
  | 'getResearchLinks'
  | 'linkResearchSource'
  | 'linkResearchExcerpt'
>;

interface StoredCollection {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

interface StoredResearch extends ImportedSummary {
  attributionNote: string | null;
  rightsNote: string | null;
  /** Derivative text for reading and search. */
  content: string;
  /** The exact original bytes. */
  original: ArrayBuffer;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

const now = () => new Date().toISOString();
const isId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const isArrayBuffer = (value: unknown): value is ArrayBuffer =>
  Object.prototype.toString.call(value) === '[object ArrayBuffer]';

function bad(message: string): never {
  throw new ApiError('validation', message);
}

function note(label: string, value: string | null | undefined): string | null {
  const text = optionalText(label, value);
  if (text !== null && Array.from(text).length > MAX_NOTE_CHARS) {
    bad(`${label} must be at most ${MAX_NOTE_CHARS} characters.`);
  }
  return text;
}

interface Meta {
  title: string;
  author: string | null;
  publisher: string | null;
  publishedDate: string | null;
  attributionNote: string | null;
  rightsNote: string | null;
}

function validateMeta(input: {
  title: string;
  author?: string | null;
  publisher?: string | null;
  publishedDate?: string | null;
  attributionNote?: string | null;
  rightsNote?: string | null;
}): Meta {
  return {
    title: requiredLine('The title', input.title),
    author: optionalLine('The author', input.author),
    publisher: optionalLine('The publisher', input.publisher),
    publishedDate: optionalCalendarDate('Published date', input.publishedDate),
    attributionNote: note('The attribution note', input.attributionNote),
    rightsNote: note('The rights note', input.rightsNote),
  };
}

function summarize(doc: StoredResearch): ImportedSummary {
  return {
    id: doc.id,
    collectionId: doc.collectionId,
    title: doc.title,
    originalName: doc.originalName,
    format: doc.format,
    sha256: doc.sha256,
    byteLength: doc.byteLength,
    pageCount: doc.pageCount,
    textTruncated: doc.textTruncated,
    extractionMethod: doc.extractionMethod,
    author: doc.author,
    publisher: doc.publisher,
    publishedDate: doc.publishedDate,
    importedAt: doc.importedAt,
    updatedAt: doc.updatedAt,
  };
}

function duplicateError(title: string): ApiError {
  return new ApiError('duplicate', `This file is already in your library as “${title}”.`);
}

const integrityError = () =>
  new ApiError(
    'integrity',
    'An archived original is missing or failed its SHA-256 integrity check.',
  );

export function createBrowserResearch(
  run: RunTransaction,
  archiveStore: string,
  sourcesStore: string,
  claimsStore: string,
): ResearchApi {
  const S = RESEARCH_STORES;

  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ValidationFailure) throw new ApiError('validation', error.message);
      throw error;
    }
  }

  async function exists(tx: IDBTransaction, store: string, id: unknown): Promise<boolean> {
    return isId(id) && (await request(tx.objectStore(store).count(id))) > 0;
  }

  async function requireRow(tx: IDBTransaction, store: string, id: unknown, message: string) {
    if (!(await exists(tx, store, id))) bad(message);
  }

  async function allSourceLinks(tx: IDBTransaction): Promise<ImportedSourceLink[]> {
    return (await request(tx.objectStore(S.sourceLinks).getAll())) as ImportedSourceLink[];
  }

  return {
    async listResearchCollections(): Promise<ResearchCollection[]> {
      return run([S.collections, S.documents], 'readonly', async (tx) => {
        const rows = (await request(tx.objectStore(S.collections).getAll())) as StoredCollection[];
        const index = tx.objectStore(S.documents).index('collectionId');
        const out: ResearchCollection[] = [];
        for (const row of rows) {
          out.push({ ...row, documentCount: await request(index.count(row.id)) });
        }
        return out.sort(
          (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id,
        );
      });
    },

    createResearchCollection(input) {
      return guarded(async () => {
        const name = validateCollectionName(input.name);
        const description = optionalText('The description', input.description);
        if (
          description !== null &&
          Array.from(description).length > MAX_COLLECTION_DESCRIPTION_CHARS
        ) {
          bad('The description must be at most 1000 characters.');
        }
        return run([S.collections], 'readwrite', async (tx) => {
          const store = tx.objectStore(S.collections);
          const rows = (await request(store.getAll())) as StoredCollection[];
          if (rows.length >= MAX_COLLECTIONS) {
            bad(`You already have the maximum of ${MAX_COLLECTIONS} collections.`);
          }
          if (rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) {
            bad('A collection with that name already exists.');
          }
          const record = { name, description, createdAt: now() };
          const id = Number(await request(store.add(record)));
          return { id, ...record, documentCount: 0 };
        });
      });
    },

    async checkResearchDuplicate(sha256): Promise<DuplicateCheck> {
      validateSha256(sha256);
      return run([S.documents, archiveStore], 'readonly', async (tx) => {
        const find = async (store: string) => {
          const row = (await request(tx.objectStore(store).index('sha256').get(sha256))) as
            | { id: number; title: string }
            | undefined;
          return row ? { id: row.id, title: row.title } : null;
        };
        return { research: await find(S.documents), archive: await find(archiveStore) };
      });
    },

    importResearch(input) {
      return guarded(async () => {
        const { title: defaultTitle, format } = validateFilename(input.name);
        const bytes = input.bytes;
        if (bytes.length === 0) bad('The selected file is empty.');
        if (bytes.length > MAX_ORIGINAL_BYTES) bad('The file is too large.');

        let content: string;
        let method: string;
        let pageCount: number | null;
        let truncated: boolean;
        if (format === 'pdf') {
          validatePdfHeader(bytes);
          content = input.extractedText ?? '';
          validateExtractedText(content);
          method = input.extractionMethod ?? '';
          validateExtractionMethod(method);
          if (input.pageCount === undefined) bad('The page count is required for a PDF.');
          validatePageCount(input.pageCount as number);
          pageCount = input.pageCount as number;
          truncated = input.textTruncated === true;
        } else {
          content = validateContent(bytes);
          method = 'utf8-text';
          pageCount = null;
          truncated = false;
        }
        const meta = validateMeta({ ...input, title: input.title ?? defaultTitle });
        const sha256 = sha256Hex(bytes);
        const original = Uint8Array.from(bytes).buffer;
        const stamp = now();

        const outcome = await run([S.collections, S.documents], 'readwrite', async (tx) => {
          await requireRow(
            tx,
            S.collections,
            input.collectionId,
            'Choose a collection that exists.',
          );
          const store = tx.objectStore(S.documents);
          const existing = (await request(store.index('sha256').get(sha256))) as
            | StoredResearch
            | undefined;
          if (existing) {
            // Same bytes already catalogued: restore a lost or damaged original from these
            // hash-verified bytes, and change nothing else.
            if (
              !isArrayBuffer(existing.original) ||
              sha256Hex(new Uint8Array(existing.original)) !== sha256
            ) {
              await request(store.put({ ...existing, original }));
            }
            return { kind: 'duplicate' as const, title: existing.title };
          }
          if ((await request(store.count())) >= MAX_DOCUMENTS) {
            bad(`You already have the maximum of ${MAX_DOCUMENTS} imported documents.`);
          }
          const record: Omit<StoredResearch, 'id'> = {
            collectionId: input.collectionId,
            title: meta.title,
            originalName: input.name,
            format,
            sha256,
            byteLength: bytes.length,
            pageCount,
            textTruncated: truncated,
            extractionMethod: method,
            author: meta.author,
            publisher: meta.publisher,
            publishedDate: meta.publishedDate,
            importedAt: stamp,
            updatedAt: stamp,
            attributionNote: meta.attributionNote,
            rightsNote: meta.rightsNote,
            content,
            original,
          };
          const id = Number(await request(store.add(record)));
          return { kind: 'created' as const, doc: { id, ...record } };
        });
        if (outcome.kind === 'duplicate') throw duplicateError(outcome.title);
        const doc = outcome.doc;
        return {
          ...summarize(doc),
          attributionNote: doc.attributionNote,
          rightsNote: doc.rightsNote,
          body: content,
        };
      });
    },

    async listResearch(collectionId): Promise<ImportedSummary[]> {
      const rows = await run(
        [S.documents],
        'readonly',
        async (tx) => (await request(tx.objectStore(S.documents).getAll())) as StoredResearch[],
      );
      return rows
        .filter((row) => collectionId === undefined || row.collectionId === collectionId)
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt) || b.id - a.id)
        .slice(0, 1000)
        .map(summarize);
    },

    async getResearch(id): Promise<ImportedDocument> {
      if (!isId(id)) bad('Invalid document ID.');
      const doc = await run(
        [S.documents],
        'readonly',
        async (tx) =>
          (await request(tx.objectStore(S.documents).get(id))) as StoredResearch | undefined,
      );
      if (!doc) throw new ApiError('not_found', 'That document could not be found.');
      if (
        !isArrayBuffer(doc.original) ||
        doc.original.byteLength !== doc.byteLength ||
        sha256Hex(new Uint8Array(doc.original)) !== doc.sha256
      ) {
        throw integrityError();
      }
      let body = doc.content;
      if (doc.format !== 'pdf') {
        try {
          body = validateContent(new Uint8Array(doc.original));
        } catch {
          throw integrityError();
        }
      }
      return {
        ...summarize(doc),
        attributionNote: doc.attributionNote,
        rightsNote: doc.rightsNote,
        body,
      };
    },

    async searchResearch(query, collectionId): Promise<ImportedHit[]> {
      let units: string[][];
      try {
        units = parseSearchQuery(query).map((unit) => tokenize(unit).map((token) => token.text));
      } catch (error) {
        if (error instanceof QueryRejection) throw new ApiError('validation', error.message);
        throw error;
      }
      units = units.filter((unit) => unit.length > 0);
      if (units.length === 0) return [];
      const docs = await run(
        [S.documents],
        'readonly',
        async (tx) => (await request(tx.objectStore(S.documents).getAll())) as StoredResearch[],
      );
      const hits: Array<{ doc: StoredResearch; score: number; snippet: string }> = [];
      for (const doc of docs) {
        if (collectionId !== undefined && doc.collectionId !== collectionId) continue;
        const matched = matchDocument(doc, units);
        if (matched) hits.push({ doc, ...matched });
      }
      return hits
        .sort((a, b) => b.score - a.score || b.doc.id - a.doc.id)
        .slice(0, MAX_SEARCH_RESULTS)
        .map(({ doc, snippet }) => ({
          id: doc.id,
          collectionId: doc.collectionId,
          title: doc.title,
          format: doc.format,
          snippet,
          importedAt: doc.importedAt,
        }));
    },

    updateResearchMetadata(id, input) {
      return guarded(async () => {
        const meta = validateMeta(input);
        return run([S.collections, S.documents], 'readwrite', async (tx) => {
          await requireRow(
            tx,
            S.collections,
            input.collectionId,
            'Choose a collection that exists.',
          );
          const store = tx.objectStore(S.documents);
          const existing = isId(id)
            ? ((await request(store.get(id))) as StoredResearch | undefined)
            : undefined;
          if (!existing) throw new ApiError('not_found', 'That document could not be found.');
          // Only user-controlled metadata changes; bytes, hash, text and import time are fixed.
          const updated: StoredResearch = {
            ...existing,
            collectionId: input.collectionId,
            ...meta,
            updatedAt: now(),
          };
          await request(store.put(updated));
          return summarize(updated);
        });
      });
    },

    async getResearchLinks(): Promise<ImportedLinks> {
      return run([S.sourceLinks, S.excerpts], 'readonly', async (tx) => ({
        sourceLinks: await allSourceLinks(tx),
        excerpts: (await request(tx.objectStore(S.excerpts).getAll())) as ImportedExcerpt[],
      }));
    },

    linkResearchSource(documentId, sourceId) {
      return guarded(() =>
        run([S.documents, sourcesStore, S.sourceLinks], 'readwrite', async (tx) => {
          await requireRow(tx, S.documents, documentId, 'That imported document does not exist.');
          await requireRow(tx, sourcesStore, sourceId, 'That source does not exist.');
          const links = await allSourceLinks(tx);
          const found = links.find(
            (link) => link.researchDocumentId === documentId && link.sourceId === sourceId,
          );
          if (found) return found;
          if (links.length >= MAX_LINKS) {
            bad(`This workspace already holds the maximum of ${MAX_LINKS} links of this kind.`);
          }
          const record = { researchDocumentId: documentId, sourceId, createdAt: now() };
          const id = Number(await request(tx.objectStore(S.sourceLinks).add(record)));
          return { id, ...record };
        }),
      );
    },

    linkResearchExcerpt(documentId, claimId, location) {
      return guarded(async () => {
        const place = validateLocation(location);
        return run(
          [S.documents, claimsStore, S.sourceLinks, S.excerpts],
          'readwrite',
          async (tx) => {
            await requireRow(tx, S.documents, documentId, 'That imported document does not exist.');
            const claim = isId(claimId)
              ? ((await request(tx.objectStore(claimsStore).get(claimId))) as
                  | { sourceId: number | null }
                  | undefined)
              : undefined;
            if (!claim) bad('That statement does not exist.');
            const links = await allSourceLinks(tx);
            const cites = links.some(
              (link) => link.researchDocumentId === documentId && link.sourceId === claim?.sourceId,
            );
            if (!cites) bad("The statement's source must be a source created from this document.");
            const store = tx.objectStore(S.excerpts);
            const excerpts = (await request(store.getAll())) as ImportedExcerpt[];
            if (excerpts.some((e) => e.claimId === claimId)) {
              bad('That statement is already recorded as an excerpt.');
            }
            if (excerpts.length >= MAX_LINKS) {
              bad(`This workspace already holds the maximum of ${MAX_LINKS} links of this kind.`);
            }
            const record = {
              researchDocumentId: documentId,
              claimId,
              location: place,
              createdAt: now(),
            };
            const id = Number(await request(store.add(record)));
            return { id, ...record };
          },
        );
      });
    },
  };
}
