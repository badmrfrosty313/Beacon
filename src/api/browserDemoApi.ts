import type { BeaconApi } from './beaconApi';
import {
  ApiError,
  type Document,
  type DocumentSummary,
  type ImportDocument,
  type LookupResult,
  type Note,
  type NoteSummary,
  type ScriptureOverview,
  type ScripturePassage,
  type SearchHit,
} from './types';
import { validateDocument, validateContent } from '../lib/documentValidation';
import {
  MATCH_END,
  MATCH_START,
  MAX_SEARCH_RESULTS,
  QueryRejection,
  parseSearchQuery,
} from '../lib/searchQuery';
import { loadScriptureEngine } from '../lib/scripture/packaged';
import { sha256Hex } from '../lib/sha256';
import { validateNote } from '../lib/validation';

// Strictly for the explicit Vite browser-demo mode. Native builds use createTauriApi
// and never silently substitute this storage when Tauri IPC fails.
//
// Schema history (IndexedDB version):
//   1: `notes`
//   2: adds `documents` (original bytes + decoded text + SHA-256, unique on sha256).
//      Upgrading keeps every existing note untouched.
const DATABASE = 'beacon-browser-demo-v1';
const DATABASE_VERSION = 2;
const NOTES = 'notes';
const DOCUMENTS = 'documents';
/** Demo-only cap: the browser has no FTS index, so search scans every stored document. */
export const MAX_DEMO_DOCUMENTS = 200;
const LIST_LIMIT = 1000;

interface StoredNote {
  id: number;
  title: string;
  body: string;
  createdAt: string;
}

interface StoredDocument {
  id: number;
  title: string;
  originalName: string;
  format: string;
  sha256: string;
  byteLength: number;
  importedAt: string;
  /** Decoded text used for display and the demo's word search. */
  content: string;
  /** The exact original bytes. */
  original: ArrayBuffer;
}

function unavailable(): ApiError {
  return new ApiError('unavailable', 'Browser IndexedDB storage is not available.');
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(unavailable());

  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE, DATABASE_VERSION);
    } catch {
      reject(unavailable());
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // Only create what is missing; existing stores (and their notes) are never touched.
      if (!db.objectStoreNames.contains(NOTES)) {
        db.createObjectStore(NOTES, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(DOCUMENTS)) {
        const documents = db.createObjectStore(DOCUMENTS, { keyPath: 'id', autoIncrement: true });
        documents.createIndex('sha256', 'sha256', { unique: true });
      }
    };
    request.onerror = () => reject(unavailable());
    request.onblocked = () =>
      reject(new ApiError('unavailable', 'Close other BEACON demo tabs and reload.'));
    request.onsuccess = () => {
      const db = request.result;
      // Let a newer tab upgrade the schema instead of blocking it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      db.close();
      reject(unavailable());
    };
    try {
      const tx = db.transaction(storeName, mode);
      tx.onerror = fail;
      tx.onabort = fail;
      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        db.close();
        resolve(result);
      };
      const request = operation(tx.objectStore(storeName));
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = fail;
    } catch {
      fail();
    }
  });
}

/** Insert a document; resolves `null` when its SHA-256 already exists (unique index). */
async function insertDocument(record: Omit<StoredDocument, 'id'>): Promise<number | null> {
  const db = await openDatabase();
  return new Promise<number | null>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      db.close();
      action();
    };
    try {
      const tx = db.transaction(DOCUMENTS, 'readwrite');
      const request = tx.objectStore(DOCUMENTS).add(record);
      let id: number | null = null;
      request.onsuccess = () => {
        id = Number(request.result);
      };
      request.onerror = (event) => {
        if (request.error?.name === 'ConstraintError') {
          // A duplicate hash is an expected outcome, not a storage failure.
          event.preventDefault();
          finish(() => resolve(null));
        }
      };
      tx.oncomplete = () => finish(() => resolve(id));
      tx.onerror = () => finish(() => reject(unavailable()));
      tx.onabort = () => finish(() => (id === null ? resolve(null) : reject(unavailable())));
    } catch {
      finish(() => reject(unavailable()));
    }
  });
}

/** Metadata only: the stored text and original bytes never travel in list payloads. */
function summarize(doc: StoredDocument): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    originalName: doc.originalName,
    format: doc.format,
    sha256: doc.sha256,
    byteLength: doc.byteLength,
    importedAt: doc.importedAt,
  };
}

// ---- Demo-only word search --------------------------------------------------------------
// A deliberately simple approximation of what the native FTS5 index does: lower-cased,
// accent-folded word tokens; every query unit must appear; a quoted phrase must appear as
// consecutive words. It is NOT SQLite FTS5 (no stemming, ranking model or index), and the UI
// says so. Native search never falls back to this code.

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)) {
    const start = match.index ?? 0;
    tokens.push({
      text: match[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(),
      start,
      end: start + match[0].length,
    });
  }
  return tokens;
}

function findUnit(tokens: Token[], unit: string[]): number[] {
  if (unit.length === 0) return [];
  const starts: number[] = [];
  for (let i = 0; i + unit.length <= tokens.length; i += 1) {
    if (unit.every((word, offset) => tokens[i + offset]?.text === word)) starts.push(i);
  }
  return starts;
}

const SNIPPET_BEFORE = 60;
const SNIPPET_AFTER = 100;

function buildSnippet(content: string, ranges: Array<[number, number]>): string {
  const first = ranges[0];
  if (first === undefined) return content.slice(0, SNIPPET_BEFORE + SNIPPET_AFTER);
  const from = Math.max(0, first[0] - SNIPPET_BEFORE);
  const to = Math.min(content.length, first[1] + SNIPPET_AFTER);
  let out = from > 0 ? '…' : '';
  let cursor = from;
  for (const [start, end] of ranges) {
    if (end <= from || start >= to) continue;
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    out += content.slice(cursor, s) + MATCH_START + content.slice(s, e) + MATCH_END;
    cursor = e;
  }
  out += content.slice(cursor, to);
  return to < content.length ? `${out}…` : out;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  return merged;
}

function matchDocument(
  doc: StoredDocument,
  units: string[][],
): { score: number; snippet: string } | null {
  const contentTokens = tokenize(doc.content);
  const titleTokens = tokenize(doc.title);
  const ranges: Array<[number, number]> = [];
  let score = 0;
  for (const unit of units) {
    const inContent = findUnit(contentTokens, unit);
    const inTitle = findUnit(titleTokens, unit);
    if (inContent.length === 0 && inTitle.length === 0) return null;
    score += inContent.length + inTitle.length * 3;
    for (const index of inContent.slice(0, 50)) {
      const startToken = contentTokens[index];
      const endToken = contentTokens[index + unit.length - 1];
      if (startToken && endToken) ranges.push([startToken.start, endToken.end]);
    }
  }
  return { score, snippet: buildSnippet(doc.content, mergeRanges(ranges)) };
}

/** `instanceof` fails across realms (iframes, test sandboxes), so check the tag instead. */
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function hashOf(original: ArrayBuffer): string {
  return sha256Hex(new Uint8Array(original));
}

/**
 * Browser-only adapter. IndexedDB is local to this browser origin and is not
 * SQLite, a native Tauri command, a backup mechanism, or an encrypted vault.
 */
export function createBrowserDemoApi(): BeaconApi {
  return {
    async getAppInfo() {
      const db = await openDatabase();
      db.close();
      return {
        appVersion: '0.1.0-browser-demo',
        dataDir: 'Browser IndexedDB: ' + DATABASE + ' (current browser only)',
        schemaVersion: DATABASE_VERSION,
        databaseError: null,
      };
    },
    async listNotes(): Promise<NoteSummary[]> {
      const notes = await transaction<StoredNote[]>(NOTES, 'readonly', (store) => store.getAll());
      return notes
        .sort((a, b) => b.id - a.id)
        .slice(0, 1000)
        .map(({ id, title, createdAt }) => ({ id, title, createdAt }));
    },
    async getNote(id: number): Promise<Note> {
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ApiError('validation', 'Invalid note ID.');
      }
      const note = await transaction<StoredNote | undefined>(NOTES, 'readonly', (store) =>
        store.get(id),
      );
      if (!note) throw new ApiError('not_found', 'That note could not be found.');
      return note;
    },
    async createNote({ title, body }): Promise<Note> {
      const errors = validateNote(title, body);
      if (errors.title || errors.body) {
        throw new ApiError('validation', errors.title ?? errors.body ?? 'Invalid note.');
      }
      const created = { title: title.trim(), body, createdAt: new Date().toISOString() };
      const id = await transaction<IDBValidKey>(NOTES, 'readwrite', (store) => store.add(created));
      return { id: Number(id), ...created };
    },

    async importDocument({ name, bytes }: ImportDocument): Promise<Document> {
      const valid = validateDocument(name, bytes);
      const original = Uint8Array.from(bytes).buffer;
      const sha256 = hashOf(original);

      const existing = await transaction<StoredDocument | undefined>(
        DOCUMENTS,
        'readonly',
        (store) => store.index('sha256').get(sha256),
      );
      const duplicate = (title: string) =>
        new ApiError('duplicate', `This file is already in your library as “${title}”.`);
      if (existing) throw duplicate(existing.title);

      const count = await transaction<number>(DOCUMENTS, 'readonly', (store) => store.count());
      if (count >= MAX_DEMO_DOCUMENTS) {
        throw new ApiError(
          'validation',
          `The browser demo stores at most ${MAX_DEMO_DOCUMENTS} documents.`,
        );
      }

      const record: Omit<StoredDocument, 'id'> = {
        title: valid.title,
        originalName: name,
        format: valid.format,
        sha256,
        byteLength: bytes.length,
        importedAt: new Date().toISOString(),
        content: valid.body,
        original,
      };
      const id = await insertDocument(record);
      if (id === null) {
        // Lost a race with another tab importing identical bytes.
        throw duplicate(valid.title);
      }
      return { ...summarize({ id, ...record }), body: valid.body };
    },

    async listDocuments(): Promise<DocumentSummary[]> {
      const docs = await transaction<StoredDocument[]>(DOCUMENTS, 'readonly', (store) =>
        store.getAll(),
      );
      return docs
        .sort((a, b) => b.id - a.id)
        .slice(0, LIST_LIMIT)
        .map(summarize);
    },

    async getDocument(id: number): Promise<Document> {
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new ApiError('validation', 'Invalid document ID.');
      }
      const doc = await transaction<StoredDocument | undefined>(DOCUMENTS, 'readonly', (store) =>
        store.get(id),
      );
      if (!doc) throw new ApiError('not_found', 'That document could not be found.');
      const integrity = () =>
        new ApiError(
          'integrity',
          'An archived original is missing or failed its SHA-256 integrity check.',
        );
      if (!isArrayBuffer(doc.original) || hashOf(doc.original) !== doc.sha256) {
        throw integrity();
      }
      let body: string;
      try {
        body = validateContent(new Uint8Array(doc.original));
      } catch {
        throw integrity();
      }
      return { ...summarize(doc), body };
    },

    async searchDocuments(query: string): Promise<SearchHit[]> {
      let units: string[][];
      try {
        units = parseSearchQuery(query).map((unit) => tokenize(unit).map((token) => token.text));
      } catch (error) {
        if (error instanceof QueryRejection) throw new ApiError('validation', error.message);
        throw error;
      }
      units = units.filter((unit) => unit.length > 0);
      if (units.length === 0) return [];

      const docs = await transaction<StoredDocument[]>(DOCUMENTS, 'readonly', (store) =>
        store.getAll(),
      );
      const hits: Array<{ doc: StoredDocument; score: number; snippet: string }> = [];
      for (const doc of docs) {
        const matched = matchDocument(doc, units);
        if (matched) hits.push({ doc, ...matched });
      }
      return hits
        .sort((a, b) => b.score - a.score || b.doc.id - a.doc.id)
        .slice(0, MAX_SEARCH_RESULTS)
        .map(({ doc, snippet }) => ({
          id: doc.id,
          title: doc.title,
          format: doc.format,
          snippet,
          importedAt: doc.importedAt,
        }));
    },
    // Scripture is read-only reference data bundled with the demo, not stored in IndexedDB, so
    // none of it can touch (or be lost with) the user's notes and documents.
    async getScriptureOverview(): Promise<ScriptureOverview> {
      return (await loadScriptureEngine()).overview();
    },
    async lookupScripture(input: string): Promise<LookupResult> {
      return (await loadScriptureEngine()).lookup(String(input));
    },
    async getScriptureChapter(bookId: string, chapter: number): Promise<ScripturePassage> {
      const passage = (await loadScriptureEngine()).chapter(String(bookId), chapter);
      if (passage === null) throw new ApiError('not_found', 'That item could not be found.');
      return passage;
    },
  };
}
