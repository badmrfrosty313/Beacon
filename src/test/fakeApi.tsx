import { render } from '@testing-library/react';
import { vi } from 'vitest';

import App from '../App';
import { ApiProvider } from '../api/ApiContext';
import {
  ApiError,
  type AppInfo,
  type Document,
  type DocumentSummary,
  type ImportDocument,
  type NewNote,
  type Note,
  type NoteSummary,
  type SearchHit,
} from '../api/types';
import { validateDocument } from '../lib/documentValidation';
import { MATCH_END, MATCH_START, parseSearchQuery } from '../lib/searchQuery';
import { sha256Hex } from '../lib/sha256';

function summaryOf(doc: Document): DocumentSummary {
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

export const DEFAULT_INFO: AppInfo = {
  appVersion: '0.1.0',
  dataDir: 'C:\\Users\\tester\\AppData\\Roaming\\org.projectbeacon.desktop',
  schemaVersion: 1,
  databaseError: null,
};

/**
 * In-memory stand-in for the Rust backend. Every method is a vi.fn so tests can assert calls
 * and override behaviour (e.g. mockRejectedValueOnce) for failure paths.
 */
export function createFakeApi(seed: Note[] = [], info: AppInfo = DEFAULT_INFO) {
  let documents: Document[] = [];
  let notes = [...seed];
  let nextId = seed.reduce((max, note) => Math.max(max, note.id), 0) + 1;

  return {
    getAppInfo: vi.fn(async (): Promise<AppInfo> => info),
    listNotes: vi.fn(async (): Promise<NoteSummary[]> =>
      [...notes]
        .sort((a, b) => b.id - a.id)
        .map(({ id, title, createdAt }) => ({ id, title, createdAt })),
    ),
    getNote: vi.fn(async (id: number): Promise<Note> => {
      const note = notes.find((candidate) => candidate.id === id);
      if (!note) throw new ApiError('not_found', 'That note could not be found.');
      return note;
    }),
    createNote: vi.fn(async ({ title, body }: NewNote): Promise<Note> => {
      const id = nextId++;
      const note: Note = {
        id,
        title: title.trim(),
        body,
        createdAt: new Date(Date.UTC(2026, 10, 2, 12, 0, id)).toISOString(),
      };
      notes = [...notes, note];
      return note;
    }),
    importDocument: vi.fn(async ({ name, bytes }: ImportDocument): Promise<Document> => {
      const valid = validateDocument(name, bytes);
      const sha256 = sha256Hex(Uint8Array.from(bytes));
      const existing = documents.find((doc) => doc.sha256 === sha256);
      if (existing) {
        throw new ApiError(
          'duplicate',
          `This file is already in your library as \u201c${existing.title}\u201d.`,
        );
      }
      const id = documents.length + 1;
      const created: Document = {
        id,
        title: valid.title,
        originalName: name,
        format: valid.format,
        sha256,
        byteLength: bytes.length,
        importedAt: new Date(Date.UTC(2026, 10, 3, 12, 0, id)).toISOString(),
        body: valid.body,
      };
      documents = [...documents, created];
      return created;
    }),
    listDocuments: vi.fn(async (): Promise<DocumentSummary[]> =>
      [...documents].reverse().map(summaryOf),
    ),
    getDocument: vi.fn(async (id: number): Promise<Document> => {
      const found = documents.find((candidate) => candidate.id === id);
      if (!found) throw new ApiError('not_found', 'That document could not be found.');
      return found;
    }),
    searchDocuments: vi.fn(async (query: string): Promise<SearchHit[]> => {
      const units = parseSearchQuery(query);
      if (units.length === 0) return [];
      return documents
        .filter((doc) =>
          units.every((unit) =>
            (doc.title + ' ' + doc.body).toLowerCase().includes(unit.toLowerCase()),
          ),
        )
        .map(({ id, title, format, body, importedAt }) => {
          const at = Math.max(0, body.toLowerCase().indexOf((units[0] as string).toLowerCase()));
          const word = units[0] as string;
          const snippet =
            body.slice(0, at) +
            MATCH_START +
            body.slice(at, at + word.length) +
            MATCH_END +
            body.slice(at + word.length, at + 120);
          return { id, title, format, snippet, importedAt };
        });
    }),
  };
}

export type FakeApi = ReturnType<typeof createFakeApi>;

export function note(id: number, title: string, body = ''): Note {
  return { id, title, body, createdAt: new Date(Date.UTC(2026, 10, 1, 9, 0, id)).toISOString() };
}

export function renderApp(
  api: FakeApi = createFakeApi(),
  initialArchiveSection: 'documents' | 'notes' = 'documents',
) {
  const utils = render(
    <ApiProvider api={api}>
      <App initialArchiveSection={initialArchiveSection} />
    </ApiProvider>,
  );
  return { api, ...utils };
}

/** Render with the Archive's Notes section open (the Sprint 001 workflow). */
export function renderNotes(api: FakeApi = createFakeApi()) {
  return renderApp(api, 'notes');
}

/** A File as the browser's file picker would hand it over. */
export function textFile(name: string, text: string): File {
  return new File([text], name, { type: 'text/plain' });
}
