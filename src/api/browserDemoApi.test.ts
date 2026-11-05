import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { createBrowserDemoApi } from './browserDemoApi';
import { sha256Hex } from '../lib/sha256';
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

const bytesOf = (text: string) => Array.from(new TextEncoder().encode(text));

describe('browser-demo documents (IndexedDB)', () => {
  it('imports, lists and reads a document, preserving the exact original bytes and hash', async () => {
    const api = createBrowserDemoApi();
    const raw = '\uFEFF# Radio\r\nSignal checks at 0900\r\n';
    const imported = await api.importDocument({ name: 'Radio.MD', bytes: bytesOf(raw) });
    expect(imported).toMatchObject({
      id: 1,
      title: 'Radio',
      originalName: 'Radio.MD',
      format: 'md',
      byteLength: new TextEncoder().encode(raw).length,
      body: '# Radio\r\nSignal checks at 0900\r\n',
    });
    expect(imported.sha256).toBe(sha256Hex(new TextEncoder().encode(raw)));

    // A new API instance models a page reload / app restart.
    const reopened = createBrowserDemoApi();
    const [summary] = await reopened.listDocuments();
    expect(summary).toEqual({
      id: 1,
      title: 'Radio',
      originalName: 'Radio.MD',
      format: 'md',
      sha256: imported.sha256,
      byteLength: imported.byteLength,
      importedAt: imported.importedAt,
    });
    expect(summary).not.toHaveProperty('body');
    expect(await reopened.getDocument(1)).toEqual(imported);
  });

  it('rejects duplicates by SHA-256 without changing the library', async () => {
    const api = createBrowserDemoApi();
    await api.importDocument({ name: 'one.txt', bytes: bytesOf('same bytes') });
    await expect(
      api.importDocument({ name: 'renamed.md', bytes: bytesOf('same bytes') }),
    ).rejects.toMatchObject({
      code: 'duplicate',
      message: expect.stringContaining('\u201cone\u201d'),
    });
    expect(await api.listDocuments()).toHaveLength(1);
    await api.importDocument({ name: 'one.txt', bytes: bytesOf('different bytes') });
    expect(await api.listDocuments()).toHaveLength(2);
  });

  it('rejects unsafe names, bad content and oversize files, storing nothing', async () => {
    const api = createBrowserDemoApi();
    const attempts = [
      { name: '../escape.md', bytes: bytesOf('x') },
      { name: 'C:\\secret.txt', bytes: bytesOf('x') },
      { name: 'scan.pdf', bytes: bytesOf('x') },
      { name: 'empty.txt', bytes: [] },
      { name: 'bad.txt', bytes: [0xff, 0xfe] },
      { name: 'nul.md', bytes: [0x61, 0x00] },
      { name: 'huge.txt', bytes: new Array<number>(1_048_577).fill(65) },
    ];
    for (const attempt of attempts) {
      await expect(api.importDocument(attempt)).rejects.toMatchObject({ code: 'validation' });
    }
    expect(await api.listDocuments()).toEqual([]);
  });

  it('keeps hostile HTML as literal text', async () => {
    const api = createBrowserDemoApi();
    const text = '<script>alert(1)</script>';
    const doc = await api.importDocument({ name: 'raw.md', bytes: bytesOf(text) });
    expect((await api.getDocument(doc.id)).body).toBe(text);
  });

  it('reports not_found and validation errors for bad ids', async () => {
    const api = createBrowserDemoApi();
    await expect(api.getDocument(99)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.getDocument(0)).rejects.toMatchObject({ code: 'validation' });
  });

  it('detects a tampered stored original instead of returning its text', async () => {
    const api = createBrowserDemoApi();
    const doc = await api.importDocument({ name: 'proof.txt', bytes: bytesOf('original') });
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('beacon-browser-demo-v1', 4);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('documents', 'readwrite');
        const store = tx.objectStore('documents');
        const get = store.get(doc.id);
        get.onsuccess = () => {
          store.put({ ...get.result, original: new TextEncoder().encode('tampered').buffer });
        };
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    await expect(api.getDocument(doc.id)).rejects.toMatchObject({ code: 'integrity' });
  });

  it('keeps existing v1 notes when the database is upgraded to the current schema', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('beacon-browser-demo-v1', 1);
      open.onupgradeneeded = () =>
        open.result.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('notes', 'readwrite');
        tx.objectStore('notes').add({
          title: 'Written by the old demo',
          body: 'still here',
          createdAt: '2026-11-02T10:00:00.000Z',
        });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    const api = createBrowserDemoApi();
    expect((await api.listNotes()).map((note) => note.title)).toEqual(['Written by the old demo']);
    expect(await api.listDocuments()).toEqual([]);
    expect((await api.getAppInfo()).schemaVersion).toBe(4);
    const doc = await api.importDocument({ name: 'new.txt', bytes: bytesOf('after upgrade') });
    expect(doc.id).toBe(1);
    expect(await api.listNotes()).toHaveLength(1);
  });
});

describe('browser-demo search (a word scan, not SQLite FTS5)', () => {
  async function library() {
    const api = createBrowserDemoApi();
    await api.importDocument({
      name: 'Bridge report.txt',
      bytes: bytesOf('Crews inspected the north bridge on Tuesday. Later the bridge was closed.'),
    });
    await api.importDocument({
      name: 'Water plan.md',
      bytes: bytesOf(
        'Store two litres per person per day.\n\u00c9vacuation caf\u00e9 on the east side.',
      ),
    });
    return api;
  }

  it('finds exact phrases only as consecutive words', async () => {
    const api = await library();
    expect((await api.searchDocuments('"north bridge"')).map((hit) => hit.title)).toEqual([
      'Bridge report',
    ]);
    expect(await api.searchDocuments('"bridge north"')).toEqual([]);
  });

  it('ANDs unquoted words in any order and ignores case and accents', async () => {
    const api = await library();
    expect(await api.searchDocuments('bridge NORTH')).toHaveLength(1);
    expect(await api.searchDocuments('evacuation CAFE')).toHaveLength(1);
    expect(await api.searchDocuments('north litres')).toEqual([]);
  });

  it('matches titles too', async () => {
    const api = await library();
    expect((await api.searchDocuments('water')).map((hit) => hit.title)).toEqual(['Water plan']);
  });

  it('returns snippets with highlight markers around the match', async () => {
    const api = await library();
    const [hit] = await api.searchDocuments('"north bridge"');
    expect(hit?.snippet).toContain('\u0001north bridge\u0002');
    const [titleOnly] = await api.searchDocuments('plan');
    expect(titleOnly?.snippet).not.toContain('\u0001');
  });

  it('treats operators and punctuation as ordinary text and never throws on hostile input', async () => {
    const api = await library();
    for (const query of [
      '',
      '   ',
      '"',
      '***',
      'north OR litres',
      'NEAR(north bridge)',
      'title:north',
      "'; DROP TABLE documents; --",
      '<img src=x onerror=alert(1)>',
      '\\',
    ]) {
      await expect(api.searchDocuments(query)).resolves.toBeInstanceOf(Array);
    }
    // "OR" is a plain word, so this requires a document containing both.
    expect(await api.searchDocuments('north OR litres')).toEqual([]);
    expect(await api.listDocuments()).toHaveLength(2);
  });

  it('rejects over-long, control-character and too-many-term queries', async () => {
    const api = await library();
    await expect(api.searchDocuments('a'.repeat(201))).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(api.searchDocuments('bad\u0000')).rejects.toMatchObject({ code: 'validation' });
    await expect(api.searchDocuments('a b c d e f g h i')).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('bounds the number of results', async () => {
    const api = createBrowserDemoApi();
    for (let i = 0; i < 12; i += 1) {
      await api.importDocument({ name: `doc${i}.txt`, bytes: bytesOf(`common word ${i}`) });
    }
    const hits = await api.searchDocuments('common');
    expect(hits.length).toBe(12);
    expect(hits.length).toBeLessThanOrEqual(100);
  });
});
