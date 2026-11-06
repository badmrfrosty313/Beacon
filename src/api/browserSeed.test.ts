import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import { createBrowserDemoApi } from './browserDemoApi';
import type { BeaconApi } from './beaconApi';
import { ApiError } from './types';
import { sha256Hex } from '../lib/sha256';

vi.setConfig({ testTimeout: 60000 });

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
});

/** Switch to a brand-new, empty browser database (a different "installation"). */
function freshInstallation(): BeaconApi {
  vi.stubGlobal('indexedDB', new IDBFactory());
  return createBrowserDemoApi();
}

const enc = (text: string) => new TextEncoder().encode(text);
const DOC = '# Synthetic page\n\nInvented text about a lighthouse.\n';
const RESEARCH = 'Invented research notes about a made-up comet.\n';

async function populate(api: BeaconApi) {
  await api.createNote({ title: 'Synthetic note', body: 'See John 3:16 for the invented theme.' });
  const doc = await api.importDocument({ name: 'lighthouse.md', bytes: Array.from(enc(DOC)) });
  const collection = await api.createResearchCollection({ name: 'Synthetic collection' });
  const research = await api.importResearch({
    name: 'comet.txt',
    bytes: enc(RESEARCH),
    collectionId: collection.id,
    author: 'A. Tester',
  });
  const event = await api.createEvent({ title: 'Invented event', eventDate: '2026-03-04' });
  const source = await api.createSource({
    title: 'Invented source',
    author: 'B. Writer',
    documentId: doc.id,
  });
  const claim = await api.createClaim({
    eventId: event.id,
    sourceId: source.id,
    kind: 'observation',
    text: 'A synthetic claim.',
    scriptureReference: 'John 3:16',
  });
  const hypothesis = await api.createHypothesis({
    title: 'Invented hypothesis',
    statement: 'A synthetic statement.',
    scriptureReference: 'Psalm 23:1',
  });
  await api.createEvidenceLink({
    hypothesisId: hypothesis.id,
    relation: 'supports',
    claimId: claim.id,
    explanation: 'Because synthetic.',
  });
  await api.linkResearchSource(research.id, source.id);
  await api.linkResearchExcerpt(research.id, claim.id, 'p. 1');
}

describe('browser SEED backup and restore', () => {
  it('round-trips the whole library into a fresh installation', async () => {
    const source = createBrowserDemoApi();
    await populate(source);
    const exported = await source.exportSeed();
    expect(exported.fileName).toMatch(/^beacon-seed-\d{8}-\d{6}\.beacon$/);
    expect(exported.warnings.join(' ')).toContain('not encrypted');
    expect(exported.packageSha256).toBe(sha256Hex(exported.bytes));
    expect(exported.tables.every((t) => t.total === 1)).toBe(true);

    const target = freshInstallation();
    const preview = await target.inspectSeed(exported.bytes);
    expect(preview.tables.every((t) => t.added === 1 && t.existing === 0)).toBe(true);
    expect(await target.listNotes()).toHaveLength(0);

    const report = await target.restoreSeed(exported.bytes, preview.packageSha256);
    expect(report.tables.every((t) => t.added === 1)).toBe(true);

    expect(await target.listNotes()).toHaveLength(1);
    const [docSummary] = await target.listDocuments();
    expect((await target.getDocument(docSummary!.id)).body).toBe(DOC);
    const [researchSummary] = await target.listResearch();
    const restored = await target.getResearch(researchSummary!.id); // re-verifies the original
    expect(restored.body).toBe(RESEARCH);
    expect(restored.sha256).toBe(sha256Hex(enc(RESEARCH)));
    expect((await target.searchResearch('comet')).length).toBe(1);

    const wt = await target.getWatchtower();
    expect(wt.events).toHaveLength(1);
    const claim = wt.claims[0]!;
    expect(claim.eventId).toBe(wt.events[0]!.id);
    expect(claim.sourceId).toBe(wt.sources[0]!.id);
    expect(claim.scriptureReference).toBe('John 3:16');
    expect(wt.sources[0]!.documentId).toBe(docSummary!.id);
    expect(wt.links[0]).toMatchObject({
      hypothesisId: wt.hypotheses[0]!.id,
      claimId: claim.id,
      relation: 'supports',
    });
    const links = await target.getResearchLinks();
    expect(links.sourceLinks[0]).toMatchObject({
      researchDocumentId: restored.id,
      sourceId: wt.sources[0]!.id,
    });
    expect(links.excerpts[0]).toMatchObject({ claimId: claim.id, location: 'p. 1' });

    // The restored library re-exports with identical content.
    const again = await target.exportSeed();
    expect(again.tables).toEqual(exported.tables);
  });

  it('adds nothing when the same package is restored again or into its own library', async () => {
    const api = createBrowserDemoApi();
    await populate(api);
    const { bytes } = await api.exportSeed();
    const sameLibrary = await api.restoreSeed(bytes, sha256Hex(bytes));
    expect(sameLibrary.tables.every((t) => t.added === 0)).toBe(true);
    expect(await api.listNotes()).toHaveLength(1);

    const other = freshInstallation();
    await other.restoreSeed(bytes, sha256Hex(bytes));
    const twice = await other.restoreSeed(bytes, sha256Hex(bytes));
    expect(twice.tables.every((t) => t.added === 0)).toBe(true);
    expect(await other.listNotes()).toHaveLength(1);
    expect((await other.getWatchtower()).links).toHaveLength(1);
  });

  it('merges into an existing library without overwriting it', async () => {
    const source = createBrowserDemoApi();
    await populate(source);
    const { bytes } = await source.exportSeed();

    const target = freshInstallation();
    await target.createNote({ title: 'My own note', body: 'Must survive.' });
    await target.createResearchCollection({
      name: 'SYNTHETIC COLLECTION',
      description: 'Local description',
    });
    await target.restoreSeed(bytes, sha256Hex(bytes));
    expect(await target.listNotes()).toHaveLength(2);
    const collections = await target.listResearchCollections();
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({ description: 'Local description', documentCount: 1 });
  });

  it('rejects damaged packages without touching existing data', async () => {
    const source = createBrowserDemoApi();
    await populate(source);
    const { bytes } = await source.exportSeed();

    const target = freshInstallation();
    await target.createNote({ title: 'Precious', body: 'Keep me.' });
    const manifestLength = new DataView(bytes.buffer).getUint32(8, true);
    const step = Math.max(1, Math.floor((bytes.length - 12 - manifestLength) / 40));
    const positions = [
      0,
      4,
      9,
      ...Array.from({ length: 40 }, (_, i) => 12 + manifestLength + i * step),
    ];
    for (const position of positions) {
      const damaged = bytes.slice();
      damaged[position] = (damaged[position] as number) ^ 1;
      const attempt = target.restoreSeed(damaged, sha256Hex(damaged));
      await expect(attempt, `flip at ${position}`).rejects.toMatchObject({ code: 'validation' });
    }
    await expect(target.inspectSeed(bytes.slice(0, -1))).rejects.toBeInstanceOf(ApiError);
    expect(await target.listNotes()).toHaveLength(1);
    expect(await target.listDocuments()).toHaveLength(0);
    expect((await target.getWatchtower()).events).toHaveLength(0);
  });

  it('requires the confirmation digest of the previewed package', async () => {
    const source = createBrowserDemoApi();
    await populate(source);
    const { bytes } = await source.exportSeed();
    const target = freshInstallation();
    await expect(target.restoreSeed(bytes, '0'.repeat(64))).rejects.toMatchObject({
      code: 'validation',
    });
    expect(await target.listNotes()).toHaveLength(0);
  });

  it('rolls back everything when the browser store rejects a record mid-restore', async () => {
    const source = createBrowserDemoApi();
    await populate(source);
    const { bytes } = await source.exportSeed();
    const target = freshInstallation();
    // Pre-fill to the demo's document cap so the restore must refuse before writing anything.
    for (let i = 0; i < 200; i += 1) {
      await target.importDocument({ name: `d${i}.txt`, bytes: Array.from(enc(`doc ${i}`)) });
    }
    await expect(target.restoreSeed(bytes, sha256Hex(bytes))).rejects.toMatchObject({
      code: 'validation',
    });
    expect(await target.listNotes()).toHaveLength(0);
    expect((await target.getWatchtower()).events).toHaveLength(0);
  });

  it('exports and restores an empty library', async () => {
    const api = createBrowserDemoApi();
    const { bytes } = await api.exportSeed();
    const target = freshInstallation();
    const report = await target.restoreSeed(bytes, sha256Hex(bytes));
    expect(report.tables.every((t) => t.total === 0)).toBe(true);
  });
});
