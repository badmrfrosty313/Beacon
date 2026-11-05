import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { createBrowserDemoApi } from './browserDemoApi';
import { buildTimeline } from '../lib/watchtower/model';

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

async function seeded() {
  const api = createBrowserDemoApi();
  const event = await api.createEvent({ title: 'Artificial test event', eventDate: '2026-03-10' });
  const source = await api.createSource({ title: 'Test bulletin', author: 'Test Author' });
  const hypothesis = await api.createHypothesis({
    title: 'Test hypothesis',
    statement: 'A proposition under test.',
  });
  return { api, event, source, hypothesis };
}

describe('browser Watchtower: records', () => {
  it('creates and edits an event, keeping the stated date and bumping updatedAt only', async () => {
    const api = createBrowserDemoApi();
    const created = await api.createEvent({
      title: '  Artificial event  ',
      eventDate: '2026-03-10T14:30-05:00',
    });
    expect(created).toMatchObject({
      id: 1,
      title: 'Artificial event',
      eventDate: '2026-03-10T14:30-05:00',
      datePrecision: 'minute',
      description: null,
    });
    const edited = await api.updateEvent(created.id, { title: 'Renamed', eventDate: '2026' });
    expect(edited).toMatchObject({ title: 'Renamed', eventDate: '2026', datePrecision: 'year' });
    expect(edited.createdAt).toBe(created.createdAt);
    const cleared = await api.updateEvent(created.id, { title: 'Renamed', eventDate: null });
    expect(cleared).toMatchObject({ eventDate: null, datePrecision: null, eventSort: null });
  });

  it('never invents a date for an undated event', async () => {
    const api = createBrowserDemoApi();
    const event = await api.createEvent({ title: 'No date known' });
    expect([event.eventDate, event.datePrecision, event.eventSort]).toEqual([null, null, null]);
  });

  it('rejects malformed dates and an instant without an explicit zone', async () => {
    const api = createBrowserDemoApi();
    for (const eventDate of ['2026-13', '2026-02-30', 'March 2026', '2026-03-10T14:30']) {
      await expect(api.createEvent({ title: 'x', eventDate })).rejects.toMatchObject({
        code: 'validation',
      });
    }
    expect((await api.getWatchtower()).events).toEqual([]);
  });

  it('keeps the four times separate: event, published, retrieved and record-created', async () => {
    const { api, event } = await seeded();
    const source = await api.createSource({
      title: 'Dated source',
      url: 'https://example.org/a',
      publishedDate: '2026-03-11',
      retrievedDate: '2026-03-12',
    });
    expect(event.eventDate).toBe('2026-03-10');
    expect(source.publishedDate).toBe('2026-03-11');
    expect(source.retrievedDate).toBe('2026-03-12');
    expect(source.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    const undated = await api.createSource({ title: 'Undated source', author: 'A' });
    expect([undated.publishedDate, undated.retrievedDate]).toEqual([null, null]);
  });

  it('requires a way to identify a source and a real Archive document', async () => {
    const api = createBrowserDemoApi();
    await expect(api.createSource({ title: 'Bare title' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(api.createSource({ title: 'Ghost copy', documentId: 42 })).rejects.toMatchObject({
      code: 'validation',
    });
    const doc = await api.importDocument({
      name: 'copy.txt',
      bytes: Array.from(new TextEncoder().encode('Preserved text')),
    });
    const linked = await api.createSource({ title: 'Preserved', documentId: doc.id });
    expect(linked.documentId).toBe(doc.id);
  });

  it('rejects a source URL that is not http(s) and stores it as plain data', async () => {
    const api = createBrowserDemoApi();
    await expect(
      api.createSource({ title: 'x', url: 'javascript:alert(1)' }),
    ).rejects.toMatchObject({ code: 'validation' });
    const ok = await api.createSource({ title: 'x', url: 'https://example.org/page' });
    expect(ok.url).toBe('https://example.org/page');
  });

  it('enforces input limits and control-character rules without echoing input', async () => {
    const api = createBrowserDemoApi();
    await expect(api.createEvent({ title: 'a'.repeat(201) })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(api.createEvent({ title: 'bad\u0000title' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(api.createEvent({ title: '   ' })).rejects.toMatchObject({ code: 'validation' });
    const error = await api.createEvent({ title: 'secret\u0007value' }).catch((e) => e);
    expect(String(error.message)).not.toContain('secret');
  });

  it('creates and edits hypotheses with a status that evidence never changes', async () => {
    const { api, hypothesis, source, event } = await seeded();
    expect(hypothesis.status).toBe('open');
    const claim = await api.createClaim({ eventId: event.id, kind: 'observation', text: 'Seen.' });
    await api.createEvidenceLink({
      hypothesisId: hypothesis.id,
      relation: 'supports',
      claimId: claim.id,
      sourceId: source.id,
      explanation: 'Because.',
    });
    expect((await api.getWatchtower()).hypotheses[0]?.status).toBe('open');
    const updated = await api.updateHypothesis(hypothesis.id, {
      title: hypothesis.title,
      statement: hypothesis.statement,
      status: 'set_aside',
    });
    expect(updated.status).toBe('set_aside');
    await expect(
      api.updateHypothesis(hypothesis.id, {
        title: 'x',
        statement: 'y',
        status: 'proven' as never,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(api.updateHypothesis(999, { title: 'x', statement: 'y' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('browser Watchtower: classification and links', () => {
  it('stores each class distinctly and requires attribution for attributed claims', async () => {
    const { api, event } = await seeded();
    for (const kind of ['observation', 'interpretation', 'forecast'] as const) {
      const claim = await api.createClaim({ eventId: event.id, kind, text: `A ${kind}.` });
      expect(claim.kind).toBe(kind);
    }
    await expect(
      api.createClaim({ eventId: event.id, kind: 'attributed_claim', text: 'Says who?' }),
    ).rejects.toMatchObject({ code: 'validation' });
    const attributed = await api.createClaim({
      eventId: event.id,
      kind: 'attributed_claim',
      text: 'A spokesperson said so.',
      attribution: 'Test spokesperson',
    });
    expect(attributed.attribution).toBe('Test spokesperson');
    await expect(
      api.createClaim({ eventId: event.id, kind: 'fact' as never, text: 'x' }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('rejects claims for missing events or sources and bad Scripture references', async () => {
    const { api, event } = await seeded();
    await expect(
      api.createClaim({ eventId: 77, kind: 'observation', text: 'x' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      api.createClaim({ eventId: event.id, sourceId: 77, kind: 'observation', text: 'x' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      api.createClaim({
        eventId: event.id,
        kind: 'interpretation',
        text: 'x',
        scriptureReference: 'a\nb',
      }),
    ).rejects.toMatchObject({ code: 'validation' });
  });

  it('links supports, contradicts and context, all with explanations and no orphans', async () => {
    const { api, event, source, hypothesis } = await seeded();
    const claimA = await api.createClaim({ eventId: event.id, kind: 'observation', text: 'A' });
    const claimB = await api.createClaim({ eventId: event.id, kind: 'forecast', text: 'B' });
    const base = { hypothesisId: hypothesis.id, explanation: 'Reason.' };
    await api.createEvidenceLink({ ...base, relation: 'supports', claimId: claimA.id });
    await api.createEvidenceLink({ ...base, relation: 'contradicts', claimId: claimB.id });
    await api.createEvidenceLink({
      ...base,
      relation: 'context',
      sourceId: source.id,
      eventId: event.id,
    });
    const { links } = await api.getWatchtower();
    expect(links.map((l) => l.relation)).toEqual(['supports', 'contradicts', 'context']);

    await expect(api.createEvidenceLink({ ...base, relation: 'supports' })).rejects.toMatchObject({
      code: 'validation',
    });
    await expect(
      api.createEvidenceLink({ ...base, relation: 'supports', claimId: 99 }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      api.createEvidenceLink({
        hypothesisId: 99,
        relation: 'supports',
        claimId: claimA.id,
        explanation: 'x',
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      api.createEvidenceLink({
        ...base,
        explanation: '  ',
        relation: 'supports',
        claimId: claimA.id,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      api.createEvidenceLink({ ...base, relation: 'proves' as never, claimId: claimA.id }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(
      api.createEvidenceLink({
        ...base,
        relation: 'supports',
        claimId: claimA.id,
        eventId: event.id,
      }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect((await api.getWatchtower()).links).toHaveLength(3);
  });

  it('refuses an exact duplicate link but allows the same evidence with another relation', async () => {
    const { api, event, hypothesis } = await seeded();
    const claim = await api.createClaim({ eventId: event.id, kind: 'observation', text: 'A' });
    const link = { hypothesisId: hypothesis.id, claimId: claim.id, explanation: 'Reason.' };
    await api.createEvidenceLink({ ...link, relation: 'supports' });
    await expect(api.createEvidenceLink({ ...link, relation: 'supports' })).rejects.toMatchObject({
      code: 'validation',
    });
    await api.createEvidenceLink({ ...link, relation: 'context' });
    expect((await api.getWatchtower()).links).toHaveLength(2);
  });

  it('preserves conflicting sources side by side without a score', async () => {
    const { api, event, hypothesis } = await seeded();
    const a = await api.createSource({ title: 'Outlet A', publisher: 'A' });
    const b = await api.createSource({ title: 'Outlet B', publisher: 'B' });
    const ca = await api.createClaim({
      eventId: event.id,
      sourceId: a.id,
      kind: 'attributed_claim',
      attribution: 'Outlet A',
      text: 'It happened on Monday.',
    });
    const cb = await api.createClaim({
      eventId: event.id,
      sourceId: b.id,
      kind: 'attributed_claim',
      attribution: 'Outlet B',
      text: 'It happened on Tuesday.',
    });
    await api.createEvidenceLink({
      hypothesisId: hypothesis.id,
      relation: 'supports',
      claimId: ca.id,
      explanation: 'One account.',
    });
    await api.createEvidenceLink({
      hypothesisId: hypothesis.id,
      relation: 'contradicts',
      claimId: cb.id,
      explanation: 'Another account.',
    });
    const snapshot = await api.getWatchtower();
    expect(snapshot.claims.map((c) => c.text)).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toMatch(/confidence|certainty|probability|score/i);
  });
});

describe('browser Watchtower: ordering, persistence, upgrade', () => {
  it('orders the timeline by EVENT date, not by the order records were created', async () => {
    const api = createBrowserDemoApi();
    await api.createEvent({ title: 'Created first, happened last', eventDate: '2026-06-01' });
    await api.createEvent({ title: 'Undated' });
    await api.createEvent({ title: 'Created second, happened first', eventDate: '1999' });
    await api.createEvent({ title: 'Same year, later month', eventDate: '2026-07' });
    const snapshot = await api.getWatchtower();
    expect(snapshot.events.map((e) => e.title)).toEqual([
      'Created second, happened first',
      'Created first, happened last',
      'Same year, later month',
      'Undated',
    ]);
    expect(buildTimeline(snapshot).map((e) => e.event.title)).toEqual(
      snapshot.events.map((e) => e.title),
    );
  });

  it('orders instants by absolute time using the stated offset', async () => {
    const api = createBrowserDemoApi();
    await api.createEvent({ title: 'Later in absolute time', eventDate: '2026-03-10T09:00-05:00' });
    await api.createEvent({
      title: 'Earlier in absolute time',
      eventDate: '2026-03-10T09:00+05:00',
    });
    expect((await api.getWatchtower()).events.map((e) => e.title)).toEqual([
      'Earlier in absolute time',
      'Later in absolute time',
    ]);
  });

  it('survives a page reload (new API instance over the same storage)', async () => {
    const { api, event, source, hypothesis } = await seeded();
    const claim = await api.createClaim({
      eventId: event.id,
      sourceId: source.id,
      kind: 'interpretation',
      text: 'My reading.',
    });
    await api.createEvidenceLink({
      hypothesisId: hypothesis.id,
      relation: 'context',
      claimId: claim.id,
      explanation: 'Background.',
    });
    const reopened = createBrowserDemoApi();
    expect(await reopened.getWatchtower()).toEqual(await api.getWatchtower());
    expect((await reopened.getWatchtower()).links).toHaveLength(1);
  });

  it('upgrades a version-2 database keeping notes and documents, and adds the new stores', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    await new Promise<void>((resolve, reject) => {
      const open = factory.open('beacon-browser-demo-v1', 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('documents', { keyPath: 'id', autoIncrement: true });
      };
      open.onsuccess = () => {
        const tx = open.result.transaction(['notes', 'documents'], 'readwrite');
        tx.objectStore('notes').add({
          title: 'Kept note',
          body: 'b',
          createdAt: '2026-01-01T00:00:00.000Z',
        });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    const api = createBrowserDemoApi();
    expect((await api.listNotes()).map((n) => n.title)).toEqual(['Kept note']);
    expect((await api.getWatchtower()).events).toEqual([]);
    const event = await api.createEvent({ title: 'After upgrade' });
    expect(event.id).toBe(1);
    expect((await api.getAppInfo()).schemaVersion).toBe(3);
  });

  it('makes no network requests', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { api, event, hypothesis } = await seeded();
    const claim = await api.createClaim({ eventId: event.id, kind: 'observation', text: 'A' });
    await api.createEvidenceLink({
      hypothesisId: hypothesis.id,
      relation: 'supports',
      claimId: claim.id,
      explanation: 'Because.',
    });
    await api.createSource({ title: 'Linked', url: 'https://example.org/never-fetched' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
