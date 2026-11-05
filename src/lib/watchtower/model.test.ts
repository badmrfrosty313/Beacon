import { describe, expect, it } from 'vitest';

import type {
  ClaimKind,
  EvidenceLink,
  LinkRelation,
  ResearchClaim,
  ResearchEvent,
  ResearchHypothesis,
  ResearchSource,
  WatchtowerSnapshot,
} from '../../api/types';
import { parseEventDate } from './dates';
import {
  buildTimeline,
  eventDateLabel,
  eventDetail,
  filterTimeline,
  hypothesisDetail,
  preview,
  sourceAvailability,
  sourceDetail,
} from './model';

const stamp = '2026-11-05T12:00:00.000Z';

function event(id: number, title: string, date: string | null): ResearchEvent {
  const parsed = date === null ? null : parseEventDate(date);
  return {
    id,
    title,
    description: null,
    eventDate: parsed?.text ?? null,
    datePrecision: parsed?.precision ?? null,
    eventSort: parsed?.sort ?? null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function source(id: number, documentId: number | null = null): ResearchSource {
  return {
    id,
    title: `Source ${id}`,
    author: 'A. Writer',
    publisher: null,
    url: documentId === null ? 'https://example.org/a' : null,
    publishedDate: null,
    retrievedDate: null,
    documentId,
    note: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function claim(
  id: number,
  eventId: number,
  kind: ClaimKind,
  sourceId: number | null = null,
): ResearchClaim {
  return {
    id,
    eventId,
    sourceId,
    kind,
    text: `Claim ${id}`,
    attribution: kind === 'attributed_claim' ? 'Someone' : null,
    scriptureReference: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function hypothesis(id: number, status: ResearchHypothesis['status'] = 'open'): ResearchHypothesis {
  return {
    id,
    title: `Hypothesis ${id}`,
    statement: 'A proposition',
    status,
    scriptureReference: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function link(
  id: number,
  hypothesisId: number,
  relation: LinkRelation,
  target: { claimId?: number; sourceId?: number; eventId?: number },
): EvidenceLink {
  return {
    id,
    hypothesisId,
    relation,
    claimId: target.claimId ?? null,
    sourceId: target.sourceId ?? null,
    eventId: target.eventId ?? null,
    explanation: `Because ${id}`,
    createdAt: stamp,
  };
}

const snapshot: WatchtowerSnapshot = {
  events: [
    event(1, 'Late', '2026-11-05'),
    event(2, 'Undated', null),
    event(3, 'Early', '1999'),
    event(4, 'Same instant, later zone', '2026-11-05T09:30-05:00'),
  ],
  sources: [source(1), source(2, 7)],
  claims: [
    claim(1, 1, 'observation'),
    claim(2, 1, 'attributed_claim', 1),
    claim(3, 3, 'forecast'),
    claim(4, 1, 'interpretation', 2),
  ],
  hypotheses: [hypothesis(1), hypothesis(2, 'set_aside')],
  links: [
    link(1, 1, 'supports', { claimId: 2 }),
    link(2, 1, 'contradicts', { claimId: 1 }),
    link(3, 1, 'context', { sourceId: 2, eventId: 2 }),
    link(4, 2, 'supports', { claimId: 3 }),
  ],
};

describe('timeline', () => {
  it('orders by event date, then undated events last', () => {
    expect(buildTimeline(snapshot).map((e) => e.event.title)).toEqual([
      'Early',
      'Late',
      'Same instant, later zone',
      'Undated',
    ]);
  });

  it('counts claims by class so the classes are never merged', () => {
    const late = buildTimeline(snapshot).find((e) => e.event.id === 1)!;
    expect(late.claimCounts).toEqual({
      observation: 1,
      attributed_claim: 1,
      interpretation: 1,
      forecast: 0,
    });
    expect(late.claimTotal).toBe(3);
  });

  it('relates hypotheses through claims and through source-only links', () => {
    const entries = buildTimeline(snapshot);
    expect(entries.find((e) => e.event.id === 1)!.hypotheses.map((h) => h.id)).toEqual([1]);
    expect(entries.find((e) => e.event.id === 2)!.hypotheses.map((h) => h.id)).toEqual([1]);
    expect(entries.find((e) => e.event.id === 3)!.hypotheses.map((h) => h.id)).toEqual([2]);
    expect(entries.find((e) => e.event.id === 4)!.hypotheses).toEqual([]);
  });

  it('filters by claim class and by hypothesis status', () => {
    const entries = buildTimeline(snapshot);
    const titles = (f: Parameters<typeof filterTimeline>[1]) =>
      filterTimeline(entries, f).map((e) => e.event.title);
    expect(titles({ kind: 'forecast', status: null })).toEqual(['Early']);
    expect(titles({ kind: null, status: 'set_aside' })).toEqual(['Early']);
    expect(titles({ kind: 'observation', status: 'set_aside' })).toEqual([]);
    expect(titles({ kind: null, status: null })).toHaveLength(4);
  });

  it('labels a missing date explicitly rather than inventing one', () => {
    expect(eventDateLabel(snapshot.events[1]!)).toBe('Undated');
    expect(eventDateLabel(snapshot.events[0]!)).toBe('2026-11-05');
  });
});

describe('detail views', () => {
  it('shows an event with its classified claims, sources, evidence and hypotheses', () => {
    const detail = eventDetail(snapshot, 1)!;
    expect(detail.claims.map((c) => c.claim.kind)).toEqual([
      'observation',
      'attributed_claim',
      'interpretation',
    ]);
    expect(detail.claims[1]!.source?.id).toBe(1);
    expect(detail.evidence.map((i) => i.link.relation).sort()).toEqual(['contradicts', 'supports']);
    expect(detail.hypotheses.map((h) => h.id)).toEqual([1]);
    expect(eventDetail(snapshot, 99)).toBeNull();
  });

  it('keeps supports, contradicts and context apart on a hypothesis', () => {
    const detail = hypothesisDetail(snapshot, 1)!;
    expect(detail.byRelation.supports.map((i) => i.claim?.id)).toEqual([2]);
    expect(detail.byRelation.contradicts.map((i) => i.claim?.id)).toEqual([1]);
    expect(detail.byRelation.context.map((i) => i.source?.id)).toEqual([2]);
    // Evidence reaches its event, source and hypothesis.
    expect(detail.byRelation.supports[0]!.event?.title).toBe('Late');
    expect(detail.byRelation.supports[0]!.source?.id).toBe(1);
    expect(hypothesisDetail(snapshot, 99)).toBeNull();
  });

  it('always lists every relation, even with no evidence', () => {
    const empty = hypothesisDetail({ ...snapshot, links: [] }, 1)!;
    expect(Object.keys(empty.byRelation).sort()).toEqual(['context', 'contradicts', 'supports']);
  });

  it('distinguishes a URL-only source from a preserved Archive copy', () => {
    expect(sourceAvailability(snapshot.sources[0]!)).toBe('metadata_only');
    expect(sourceAvailability(snapshot.sources[1]!)).toBe('archived_copy');
    const detail = sourceDetail(snapshot, 2)!;
    expect(detail.availability).toBe('archived_copy');
    expect(detail.claims.map((c) => c.id)).toEqual([4]);
    expect(detail.evidence.map((i) => i.link.id)).toEqual([3]);
    expect(sourceDetail(snapshot, 99)).toBeNull();
  });

  it('never changes a hypothesis status because of the evidence', () => {
    expect(hypothesisDetail(snapshot, 1)!.hypothesis.status).toBe('open');
  });
});

describe('preview', () => {
  it('collapses whitespace and truncates by code point', () => {
    expect(preview('a\n  b')).toBe('a b');
    expect(preview('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(preview('😀'.repeat(5), 3)).toBe('😀😀…');
  });
});
