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
      const id = documents.length + 1;
      const created: Document = {
        id,
        title: valid.title,
        originalName: name,
        format: valid.format,
        sha256: String(id).padStart(64, '0'),
        byteLength: bytes.length,
        importedAt: new Date(Date.UTC(2026, 10, 3, 12, 0, id)).toISOString(),
        body: valid.body,
      };
      documents = [...documents, created];
      return created;
    }),
    listDocuments: vi.fn(async (): Promise<DocumentSummary[]> =>
      [...documents].reverse().map(({ body: _body, ...summary }) => summary),
    ),
    getDocument: vi.fn(async (id: number): Promise<Document> => {
      const found = documents.find((candidate) => candidate.id === id);
      if (!found) throw new ApiError('not_found', 'That document could not be found.');
      return found;
    }),
    searchDocuments: vi.fn(async (query: string): Promise<SearchHit[]> =>
      documents
        .filter((doc) => (doc.title + doc.body).toLowerCase().includes(query.toLowerCase()))
        .map(({ id, title, format, body, importedAt }) => ({
          id,
          title,
          format,
          snippet: body.slice(0, 120),
          importedAt,
        })),
    ),
  };
}

export type FakeApi = ReturnType<typeof createFakeApi>;

export function note(id: number, title: string, body = ''): Note {
  return { id, title, body, createdAt: new Date(Date.UTC(2026, 10, 1, 9, 0, id)).toISOString() };
}

export function renderApp(api: FakeApi = createFakeApi()) {
  const utils = render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
  return { api, ...utils };
}
