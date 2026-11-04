import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { testScriptureEngine } from '../test/scriptureEngine';
import { createBrowserDemoApi } from './browserDemoApi';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser demo Scripture API', () => {
  it('gives the same answers as the engine the desktop parity vectors use', async () => {
    const api = createBrowserDemoApi();
    const overview = await api.getScriptureOverview();
    expect(overview.books).toHaveLength(66);
    expect(overview).toEqual(testScriptureEngine().overview());

    for (const input of ['Revelation 13:16-18', 'Rev 13:18', 'Psalm 23', '3 John 1:2']) {
      expect(await api.lookupScripture(input)).toEqual(testScriptureEngine().lookup(input));
    }
  });

  it('reports unusable references as data, not as exceptions', async () => {
    const api = createBrowserDemoApi();
    const result = await api.lookupScripture('John 22');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.code).toBe('out_of_range');
  });

  it('returns whole chapters and not_found for chapters that do not exist', async () => {
    const api = createBrowserDemoApi();
    expect((await api.getScriptureChapter('REV', 13)).verses).toHaveLength(18);
    await expect(api.getScriptureChapter('REV', 23)).rejects.toMatchObject({ code: 'not_found' });
    await expect(api.getScriptureChapter('XXX', 1)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('makes no network calls of any kind while reading', async () => {
    const fetchSpy = vi.fn();
    const xhrSpy = vi.fn();
    const wsSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    vi.stubGlobal('WebSocket', wsSpy);

    const api = createBrowserDemoApi();
    await api.getScriptureOverview();
    await api.lookupScripture('Genesis 1:1');
    await api.getScriptureChapter('PSA', 23);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
    expect(wsSpy).not.toHaveBeenCalled();
  });

  it('keeps existing notes and documents untouched (IndexedDB schema unchanged)', async () => {
    const api = createBrowserDemoApi();
    const note = await api.createNote({ title: 'Before', body: 'kept' });
    const doc = await api.importDocument({ name: 'a.txt', bytes: [104, 105] });

    await api.lookupScripture('John 3:16');
    await api.getScriptureChapter('GEN', 1);

    const reopened = createBrowserDemoApi();
    expect(await reopened.getNote(note.id)).toEqual(note);
    expect((await reopened.getDocument(doc.id)).body).toBe('hi');
    expect(await reopened.listNotes()).toHaveLength(1);
    expect(await reopened.listDocuments()).toHaveLength(1);
  });

  it('saves a note created from a reference with the existing storage and reloads it', async () => {
    const api = createBrowserDemoApi();
    const saved = await api.createNote({
      title: 'Revelation 13:18',
      body: 'Scripture reference: Revelation 13:18 (WEB)\n\nMy notes:\nresearch',
    });
    const reopened = createBrowserDemoApi();
    expect((await reopened.getNote(saved.id)).body).toContain('Revelation 13:18 (WEB)');
  });
});
