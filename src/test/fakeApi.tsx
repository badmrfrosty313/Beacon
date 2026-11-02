import { render } from '@testing-library/react';
import { vi } from 'vitest';

import App from '../App';
import { ApiProvider } from '../api/ApiContext';
import { ApiError, type AppInfo, type NewNote, type Note, type NoteSummary } from '../api/types';

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
