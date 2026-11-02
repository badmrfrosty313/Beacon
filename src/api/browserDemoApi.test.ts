import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { createBrowserDemoApi } from './browserDemoApi';
import { ApiError } from './types';

beforeEach(() => {
  // A fresh simulated browser storage area for each test, with real IndexedDB transactions.
  vi.stubGlobal('indexedDB', new IDBFactory());
});

describe('isolated browser-demo storage', () => {
  it('creates and reads notes across new API instances (page-reload equivalent)', async () => {
    const first = createBrowserDemoApi();
    const saved = await first.createNote({ title: '  First Light  ', body: 'Local test note' });
    expect(saved.title).toBe('First Light');
    expect(saved.id).toBe(1);

    const reopened = createBrowserDemoApi();
    expect(await reopened.getNote(saved.id)).toEqual(saved);
    expect(await reopened.listNotes()).toEqual([
      { id: saved.id, title: 'First Light', createdAt: saved.createdAt },
    ]);
  });

  it('sorts notes newest first and does not expose SQLite in app information', async () => {
    const api = createBrowserDemoApi();
    await api.createNote({ title: 'Earlier', body: '' });
    await api.createNote({ title: 'Later', body: 'Later body' });
    expect((await api.listNotes()).map((note) => note.title)).toEqual(['Later', 'Earlier']);
    const info = await api.getAppInfo();
    expect(info.dataDir).toContain('Browser IndexedDB:');
    expect(info.appVersion).toContain('browser-demo');
  });

  it('rejects invalid note fields and missing IDs', async () => {
    const api = createBrowserDemoApi();
    await expect(api.createNote({ title: '', body: '' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(api.getNote(90)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.getNote(-1)).rejects.toMatchObject({ code: 'validation' });
    expect(await api.listNotes()).toEqual([]);
  });

  it('fails explicitly if IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const api = createBrowserDemoApi();
    await expect(api.listNotes()).rejects.toBeInstanceOf(ApiError);
    await expect(api.listNotes()).rejects.toMatchObject({ code: 'unavailable' });
  });
});
