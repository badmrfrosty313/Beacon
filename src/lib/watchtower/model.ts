/**
 * Derived views over a Watchtower snapshot: the timeline, the detail of an event, a source or
 * a hypothesis, and the labels the UI shows. Pure functions of the snapshot, shared by the
 * native and browser backends so both present identical results.
 *
 * Nothing here scores, ranks or concludes. A hypothesis keeps every supporting, contradicting
 * and contextual link side by side; the user decides what they mean.
 */
import type {
  ClaimKind,
  DatePrecision,
  EvidenceLink,
  HypothesisStatus,
  LinkRelation,
  ResearchClaim,
  ResearchEvent,
  ResearchHypothesis,
  ResearchSource,
  WatchtowerSnapshot,
} from '../../api/types';

export const CLAIM_KIND_LABEL: Record<ClaimKind, string> = {
  observation: 'Observation',
  attributed_claim: 'Attributed claim',
  interpretation: 'Interpretation',
  forecast: 'Forecast',
};

export const CLAIM_KIND_HINT: Record<ClaimKind, string> = {
  observation: 'Something directly seen or measured, with no claim about its meaning.',
  attributed_claim: 'What a named person or organisation says. Not confirmed by being recorded.',
  interpretation: 'Your or someone’s reading of what it means. Not a documented fact.',
  forecast: 'A statement about what may happen. Not an event that has happened.',
};

export const STATUS_LABEL: Record<HypothesisStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  set_aside: 'Set aside',
};

export const RELATION_LABEL: Record<LinkRelation, string> = {
  supports: 'Supports',
  contradicts: 'Contradicts',
  context: 'Context',
};

export const PRECISION_LABEL: Record<DatePrecision, string> = {
  year: 'year only',
  month: 'year and month',
  day: 'calendar day',
  minute: 'date and time, zone as entered',
};

/** A URL alone is not an offline copy; only a linked Archive document is. */
export type SourceAvailability = 'archived_copy' | 'metadata_only';

export function sourceAvailability(source: ResearchSource): SourceAvailability {
  return source.documentId === null ? 'metadata_only' : 'archived_copy';
}

export const AVAILABILITY_LABEL: Record<SourceAvailability, string> = {
  archived_copy: 'Preserved copy in your Archive',
  metadata_only: 'Metadata only — no offline copy',
};

/** The event date as the user stated it, or an explicit "Undated" (never a guessed date). */
export function eventDateLabel(event: ResearchEvent): string {
  return event.eventDate ?? 'Undated';
}

// ---- Timeline -----------------------------------------------------------------------------

export interface TimelineEntry {
  event: ResearchEvent;
  claimCounts: Record<ClaimKind, number>;
  claimTotal: number;
  /** Hypotheses reached through this event's claims or through source-only links to it. */
  hypotheses: ResearchHypothesis[];
}

function emptyCounts(): Record<ClaimKind, number> {
  return { observation: 0, attributed_claim: 0, interpretation: 0, forecast: 0 };
}

/** The event a link is about: its claim's event, else the event chosen for source-only evidence. */
function linkEventId(link: EvidenceLink, claims: Map<number, ResearchClaim>): number | null {
  if (link.claimId !== null) return claims.get(link.claimId)?.eventId ?? null;
  return link.eventId;
}

function byEventTime(a: ResearchEvent, b: ResearchEvent): number {
  if (a.eventSort === null && b.eventSort === null) return a.id - b.id;
  if (a.eventSort === null) return 1;
  if (b.eventSort === null) return -1;
  return a.eventSort - b.eventSort || a.id - b.id;
}

/** Dated events oldest first by EVENT date, then undated events in the order they were made. */
export function buildTimeline(snapshot: WatchtowerSnapshot): TimelineEntry[] {
  const claimsById = new Map(snapshot.claims.map((claim) => [claim.id, claim]));
  const hypothesesById = new Map(snapshot.hypotheses.map((h) => [h.id, h]));

  return [...snapshot.events].sort(byEventTime).map((event) => {
    const counts = emptyCounts();
    let total = 0;
    for (const claim of snapshot.claims) {
      if (claim.eventId === event.id) {
        counts[claim.kind] += 1;
        total += 1;
      }
    }
    const related = new Set<number>();
    for (const link of snapshot.links) {
      if (linkEventId(link, claimsById) === event.id) related.add(link.hypothesisId);
    }
    const hypotheses = [...related]
      .map((id) => hypothesesById.get(id))
      .filter((h): h is ResearchHypothesis => h !== undefined)
      .sort((a, b) => a.id - b.id);
    return { event, claimCounts: counts, claimTotal: total, hypotheses };
  });
}

export interface TimelineFilter {
  /** Keep events that have at least one claim of this kind. */
  kind: ClaimKind | null;
  /** Keep events related to a hypothesis with this status. */
  status: HypothesisStatus | null;
}

export function filterTimeline(entries: TimelineEntry[], filter: TimelineFilter): TimelineEntry[] {
  return entries.filter(
    (entry) =>
      (filter.kind === null || entry.claimCounts[filter.kind] > 0) &&
      (filter.status === null || entry.hypotheses.some((h) => h.status === filter.status)),
  );
}

// ---- Detail views -------------------------------------------------------------------------

/** One piece of evidence with everything needed to show where it came from. */
export interface EvidenceItem {
  link: EvidenceLink;
  claim: ResearchClaim | null;
  source: ResearchSource | null;
  /** The event the evidence concerns (from the claim, else the chosen event). */
  event: ResearchEvent | null;
  hypothesis: ResearchHypothesis | null;
}

function evidenceItems(snapshot: WatchtowerSnapshot): EvidenceItem[] {
  const claims = new Map(snapshot.claims.map((c) => [c.id, c]));
  const sources = new Map(snapshot.sources.map((s) => [s.id, s]));
  const events = new Map(snapshot.events.map((e) => [e.id, e]));
  const hypotheses = new Map(snapshot.hypotheses.map((h) => [h.id, h]));
  return snapshot.links.map((link) => {
    const claim = link.claimId === null ? null : (claims.get(link.claimId) ?? null);
    // A link names a claim, a source, or both. A claim's own source is shown when the link has none.
    const sourceId = link.sourceId ?? claim?.sourceId ?? null;
    const eventId = claim !== null ? claim.eventId : link.eventId;
    return {
      link,
      claim,
      source: sourceId === null ? null : (sources.get(sourceId) ?? null),
      event: eventId === null ? null : (events.get(eventId) ?? null),
      hypothesis: hypotheses.get(link.hypothesisId) ?? null,
    };
  });
}

export interface EventDetail {
  event: ResearchEvent;
  claims: Array<{ claim: ResearchClaim; source: ResearchSource | null }>;
  evidence: EvidenceItem[];
  hypotheses: ResearchHypothesis[];
}

export function eventDetail(snapshot: WatchtowerSnapshot, eventId: number): EventDetail | null {
  const event = snapshot.events.find((e) => e.id === eventId);
  if (event === undefined) return null;
  const sources = new Map(snapshot.sources.map((s) => [s.id, s]));
  const claims = snapshot.claims
    .filter((claim) => claim.eventId === eventId)
    .map((claim) => ({
      claim,
      source: claim.sourceId === null ? null : (sources.get(claim.sourceId) ?? null),
    }));
  const evidence = evidenceItems(snapshot).filter((item) => item.event?.id === eventId);
  const seen = new Set<number>();
  const hypotheses: ResearchHypothesis[] = [];
  for (const item of evidence) {
    if (item.hypothesis !== null && !seen.has(item.hypothesis.id)) {
      seen.add(item.hypothesis.id);
      hypotheses.push(item.hypothesis);
    }
  }
  return { event, claims, evidence, hypotheses };
}

export interface SourceDetail {
  source: ResearchSource;
  availability: SourceAvailability;
  claims: ResearchClaim[];
  evidence: EvidenceItem[];
}

export function sourceDetail(snapshot: WatchtowerSnapshot, sourceId: number): SourceDetail | null {
  const source = snapshot.sources.find((s) => s.id === sourceId);
  if (source === undefined) return null;
  return {
    source,
    availability: sourceAvailability(source),
    claims: snapshot.claims.filter((claim) => claim.sourceId === sourceId),
    evidence: evidenceItems(snapshot).filter((item) => item.source?.id === sourceId),
  };
}

export interface HypothesisDetail {
  hypothesis: ResearchHypothesis;
  /** Every relation is always present, even when empty, so conflicting evidence is never hidden. */
  byRelation: Record<LinkRelation, EvidenceItem[]>;
}

export function hypothesisDetail(
  snapshot: WatchtowerSnapshot,
  hypothesisId: number,
): HypothesisDetail | null {
  const hypothesis = snapshot.hypotheses.find((h) => h.id === hypothesisId);
  if (hypothesis === undefined) return null;
  const byRelation: Record<LinkRelation, EvidenceItem[]> = {
    supports: [],
    contradicts: [],
    context: [],
  };
  for (const item of evidenceItems(snapshot)) {
    if (item.link.hypothesisId === hypothesisId) byRelation[item.link.relation].push(item);
  }
  return { hypothesis, byRelation };
}

/** A short single-line preview of long text for lists and select options. */
export function preview(text: string, max = 80): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const points = Array.from(line);
  return points.length <= max ? line : `${points.slice(0, max - 1).join('')}…`;
}
