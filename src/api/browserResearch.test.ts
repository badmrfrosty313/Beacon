import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { createBrowserDemoApi } from './browserDemoApi';
import type { BeaconApi } from './beaconApi';
import { sha256Hex } from '../lib/sha256';

vi.setConfig({ testTimeout: 60000 });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

const bytesOf = (text: string) => new TextEncoder().encode(text);
const PDF = bytesOf('%PDF-1.4\ninvented pdf bytes\n%%EOF');

async function library() {
  const api = createBrowserDemoApi();
  const collection = await api.createResearchCollection({ name: 'Synthetic research' });
  return { api, collection };
}

function pdfInput(collectionId: number, text = 'Invented page text') {
  return {
    name: 'synthetic.pdf',
    bytes: PDF,
    collectionId,
    extractedText: text,
    extractionMethod: 'pdfjs-text-layer',
    pageCount: 2,
  };
}

describe('browser research: import and provenance', () => {
  it('keeps the exact original, hash and derivative text for Markdown', async () => {
    const { api, collection } = await library();
    const body = '# Invented\n\nLine α.\n';
    const doc = await api.importResearch({
      name: 'notes.md',
      bytes: bytesOf(body),
      collectionId: collection.id,
      author: 'A. Synthetic',
      publishedDate: '2001-05',
      rightsNote: 'private use only',
    });
    expect(doc).toMatchObject({
      title: 'notes',
      format: 'md',
      body,
      extractionMethod: 'utf8-text',
      sha256: sha256Hex(bytesOf(body)),
      author: 'A. Synthetic',
      publishedDate: '2001-05',
      rightsNote: 'private use only',
    });
    expect(doc.importedAt).not.toBe(doc.publishedDate);
    expect(await api.getResearch(doc.id)).toMatchObject({ body, sha256: doc.sha256 });
  });

  it('imports a PDF with caller-supplied text, page count and method', async () => {
    const { api, collection } = await library();
    const doc = await api.importResearch(pdfInput(collection.id));
    expect(doc).toMatchObject({
      format: 'pdf',
      pageCount: 2,
      extractionMethod: 'pdfjs-text-layer',
    });
    expect((await api.getResearch(doc.id)).body).toBe('Invented page text');
  });

  it('rejects bad input without storing anything', async () => {
    const { api, collection } = await library();
    const cid = collection.id;
    const bad = [
      { name: '../evil.md', bytes: bytesOf('x'), collectionId: cid },
      { name: 'macro.docx', bytes: bytesOf('x'), collectionId: cid },
      { name: 'a.md', bytes: new Uint8Array(), collectionId: cid },
      { name: 'a.md', bytes: bytesOf('bad \u0000'), collectionId: cid },
      { name: 'a.md', bytes: bytesOf('x'), collectionId: cid + 50 },
      { ...pdfInput(cid), bytes: bytesOf('not a pdf') },
      pdfInput(cid, '   '),
      { ...pdfInput(cid), pageCount: undefined },
      { ...pdfInput(cid), extractionMethod: '' },
      { name: 'a.md', bytes: bytesOf('x'), collectionId: cid, publishedDate: 'last spring' },
    ];
    for (const input of bad) {
      await expect(api.importResearch(input)).rejects.toMatchObject({ code: 'validation' });
    }
    expect(await api.listResearch()).toEqual([]);
  });

  it('detects duplicates, changes nothing, and restores a damaged original', async () => {
    const { api, collection } = await library();
    const first = await api.importResearch({
      name: 'a.txt',
      bytes: bytesOf('same bytes'),
      collectionId: collection.id,
    });
    await expect(
      api.importResearch({
        name: 'renamed.txt',
        bytes: bytesOf('same bytes'),
        collectionId: collection.id,
      }),
    ).rejects.toMatchObject({ code: 'duplicate' });
    expect(await api.listResearch()).toHaveLength(1);

    await tamper(first.id);
    await expect(api.getResearch(first.id)).rejects.toMatchObject({ code: 'integrity' });
    await expect(
      api.importResearch({
        name: 'a.txt',
        bytes: bytesOf('same bytes'),
        collectionId: collection.id,
      }),
    ).rejects.toMatchObject({ code: 'duplicate' });
    expect((await api.getResearch(first.id)).body).toBe('same bytes');
  });

  it('reports duplicates in both libraries before import', async () => {
    const { api, collection } = await library();
    const bytes = bytesOf('shared bytes');
    await api.importDocument({ name: 'arch.md', bytes: Array.from(bytes) });
    const sha = sha256Hex(bytes);
    expect(await api.checkResearchDuplicate(sha)).toMatchObject({
      archive: { title: 'arch' },
      research: null,
    });
    await api.importResearch({ name: 'r.md', bytes, collectionId: collection.id });
    expect(await api.checkResearchDuplicate(sha)).toMatchObject({
      archive: { title: 'arch' },
      research: { title: 'r' },
    });
    await expect(api.checkResearchDuplicate('nope')).rejects.toMatchObject({ code: 'validation' });
  });

  it('flags a tampered original as an integrity failure', async () => {
    const { api, collection } = await library();
    const doc = await api.importResearch({
      name: 'a.md',
      bytes: bytesOf('original'),
      collectionId: collection.id,
    });
    await tamper(doc.id);
    await expect(api.getResearch(doc.id)).rejects.toMatchObject({ code: 'integrity' });
  });
});

describe('browser research: collections, metadata and search', () => {
  it('keeps collection names unique and counts documents', async () => {
    const { api, collection } = await library();
    await expect(
      api.createResearchCollection({ name: 'synthetic RESEARCH' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(api.createResearchCollection({ name: '  ' })).rejects.toMatchObject({
      code: 'validation',
    });
    await api.importResearch({ name: 'a.md', bytes: bytesOf('x1'), collectionId: collection.id });
    expect(await api.listResearchCollections()).toMatchObject([
      { name: 'Synthetic research', documentCount: 1 },
    ]);
  });

  it('updates only user metadata, re-indexes the title and never touches bytes', async () => {
    const { api, collection } = await library();
    const other = await api.createResearchCollection({ name: 'Astronomy' });
    const doc = await api.importResearch({
      name: 'a.md',
      bytes: bytesOf('body words'),
      collectionId: collection.id,
    });
    const updated = await api.updateResearchMetadata(doc.id, {
      collectionId: other.id,
      title: 'Zebrafish ledger',
      rightsNote: 'private',
    });
    expect(updated).toMatchObject({
      collectionId: other.id,
      sha256: doc.sha256,
      importedAt: doc.importedAt,
    });
    expect((await api.searchResearch('zebrafish')).map((h) => h.id)).toEqual([doc.id]);
    expect(await api.searchResearch('body', collection.id)).toEqual([]);
    expect((await api.getResearch(doc.id)).body).toBe('body words');
    await expect(
      api.updateResearchMetadata(999, { collectionId: other.id, title: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('searches imported text and treats operators as text', async () => {
    const { api, collection } = await library();
    await api.importResearch({
      name: 'a.md',
      bytes: bytesOf('The invented comet orbit AND more'),
      collectionId: collection.id,
    });
    expect(await api.searchResearch('comet')).toHaveLength(1);
    expect(await api.searchResearch('AND')).toHaveLength(1);
    expect(await api.searchResearch('absent')).toEqual([]);
    expect(await api.searchResearch('   ')).toEqual([]);
  });

  it('is private by construction: the API has no publish, sync or export call', async () => {
    const { api } = await library();
    const names = Object.keys(api as BeaconApi).filter((name) => /research/i.test(name));
    expect(names.filter((name) => /publish|sync|upload|share|export/i.test(name))).toEqual([]);
  });
});

async function seedMapping() {
  const { api, collection } = await library();
  const doc = await api.importResearch({
    name: 'a.md',
    bytes: bytesOf('x'),
    collectionId: collection.id,
  });
  const other = await api.importResearch({
    name: 'b.md',
    bytes: bytesOf('y'),
    collectionId: collection.id,
  });
  const event = await api.createEvent({ title: 'Synthetic event' });
  const source = await api.createSource({ title: 'Synthetic source' });
  const claim = await api.createClaim({
    eventId: event.id,
    sourceId: source.id,
    kind: 'interpretation',
    text: 'Invented excerpt',
  });
  const hypothesis = await api.createHypothesis({ title: 'H', statement: 'S' });
  return { api, doc, other, source, claim, hypothesis };
}

describe('browser research: explicit Watchtower mapping', () => {
  it('enforces the linking rules', async () => {
    const { api, doc, other, source, claim } = await seedMapping();
    await expect(api.linkResearchExcerpt(doc.id, claim.id)).rejects.toMatchObject({
      code: 'validation',
    });
    const a = await api.linkResearchSource(doc.id, source.id);
    const b = await api.linkResearchSource(doc.id, source.id);
    expect(a.id).toBe(b.id);
    await expect(api.linkResearchSource(999, source.id)).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(api.linkResearchSource(doc.id, 999)).rejects.toMatchObject({ code: 'validation' });
    await expect(api.linkResearchExcerpt(other.id, claim.id)).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(api.linkResearchExcerpt(doc.id, claim.id, 'x'.repeat(101))).rejects.toMatchObject({
      code: 'validation',
    });
    const excerpt = await api.linkResearchExcerpt(doc.id, claim.id, ' page 3 ');
    expect(excerpt.location).toBe('page 3');
    await expect(api.linkResearchExcerpt(doc.id, claim.id)).rejects.toMatchObject({
      code: 'validation',
    });
    const links = await api.getResearchLinks();
    expect([links.sourceLinks.length, links.excerpts.length]).toEqual([1, 1]);
  });

  it('attaches an excerpt to a hypothesis only through an explicit evidence link', async () => {
    const { api, doc, source, claim, hypothesis } = await seedMapping();
    await api.linkResearchSource(doc.id, source.id);
    await api.linkResearchExcerpt(doc.id, claim.id);
    expect((await api.getWatchtower()).links).toEqual([]);
    const link = await api.createEvidenceLink({
      hypothesisId: hypothesis.id,
      relation: 'contradicts',
      claimId: claim.id,
      explanation: 'Invented reason.',
    });
    expect(link.relation).toBe('contradicts');
  });
});

describe('browser research: persistence and upgrade', () => {
  it('survives a restart (a fresh adapter over the same database)', async () => {
    const { api, collection } = await library();
    const doc = await api.importResearch({
      name: 'a.md',
      bytes: bytesOf('persisted text'),
      collectionId: collection.id,
    });
    const reopened = createBrowserDemoApi();
    expect((await reopened.getResearch(doc.id)).body).toBe('persisted text');
    expect(await reopened.searchResearch('persisted')).toHaveLength(1);
    expect(await reopened.listResearchCollections()).toHaveLength(1);
  });

  it('upgrades a v3 database without touching notes, documents or Watchtower records', async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('beacon-browser-demo-v1', 3);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true }).createIndex(
          'sha256',
          'sha256',
          { unique: true },
        );
        for (const name of ['wt_events', 'wt_sources', 'wt_claims', 'wt_hypotheses', 'wt_links']) {
          db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        }
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction(['notes', 'wt_sources'], 'readwrite');
        tx.objectStore('notes').add({
          title: 'Old note',
          body: 'kept',
          createdAt: '2026-11-02T10:00:00.000Z',
        });
        tx.objectStore('wt_sources').add({
          title: 'Old source',
          createdAt: '2026-11-02T10:00:00.000Z',
        });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    const api = createBrowserDemoApi();
    expect((await api.listNotes()).map((n) => n.title)).toEqual(['Old note']);
    expect((await api.getWatchtower()).sources.map((s) => s.title)).toEqual(['Old source']);
    expect(await api.listResearch()).toEqual([]);
    const collection = await api.createResearchCollection({ name: 'After upgrade' });
    const doc = await api.importResearch({
      name: 'a.md',
      bytes: bytesOf('new'),
      collectionId: collection.id,
    });
    expect(doc.id).toBe(1);
    expect(await api.listNotes()).toHaveLength(1);
  });
});

/** Overwrite a stored original with different bytes, as disk corruption or tampering would. */
async function tamper(id: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('beacon-browser-demo-v1');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('rs_documents', 'readwrite');
      const store = tx.objectStore('rs_documents');
      const get = store.get(id);
      get.onsuccess = () => {
        store.put({ ...get.result, original: bytesOf('tampered').buffer });
      };
      tx.oncomplete = () => {
        open.result.close();
        resolve();
      };
    };
  });
}
