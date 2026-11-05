import type { ReactNode } from 'react';

import type { LinkRelation, ResearchClaim, ResearchSource } from '../../api/types';
import { CLAIM_KINDS, LINK_RELATIONS } from '../../api/types';
import {
  AVAILABILITY_LABEL,
  CLAIM_KIND_LABEL,
  PRECISION_LABEL,
  RELATION_LABEL,
  STATUS_LABEL,
  eventDateLabel,
  type EvidenceItem,
  type TimelineEntry,
} from '../../lib/watchtower/model';
import { ClaimKindBadge } from './fields';

export function ScriptureRef({
  reference,
  onOpen,
}: {
  reference: string | null;
  onOpen?: (reference: string) => void;
}) {
  if (reference === null) return null;
  return (
    <p className="wt-ref">
      Scripture reference: <span>{reference}</span>{' '}
      {onOpen ? (
        <button type="button" className="link-button" onClick={() => onOpen(reference)}>
          Open in Scripture
        </button>
      ) : null}
    </p>
  );
}

export function SourceLine({ source }: { source: ResearchSource | null }) {
  if (source === null) return <span className="muted">No source recorded</span>;
  return <span>Source: {source.title}</span>;
}

export function ClaimItem({
  claim,
  source,
  onOpenScripture,
}: {
  claim: ResearchClaim;
  source: ResearchSource | null;
  onOpenScripture?: (reference: string) => void;
}) {
  return (
    <li className={`wt-claim wt-claim-${claim.kind}`}>
      <ClaimKindBadge kind={claim.kind} />
      <p className="wt-claim-text">{claim.text}</p>
      {claim.attribution ? <p className="muted">Attributed to: {claim.attribution}</p> : null}
      <p className="muted">
        <SourceLine source={source} />
      </p>
      <ScriptureRef reference={claim.scriptureReference} onOpen={onOpenScripture} />
    </li>
  );
}

export function EvidenceList({
  items,
  onOpenEvent,
  onOpenSource,
  onOpenHypothesis,
}: {
  items: EvidenceItem[];
  onOpenEvent?: (id: number) => void;
  onOpenSource?: (id: number) => void;
  onOpenHypothesis?: (id: number) => void;
}) {
  return (
    <ul className="plain-list wt-evidence">
      {items.map(({ link, claim, source, event, hypothesis }) => (
        <li key={link.id} className={`wt-link wt-link-${link.relation}`}>
          <span className={`relation-badge relation-${link.relation}`}>
            {RELATION_LABEL[link.relation]}
          </span>{' '}
          {hypothesis && onOpenHypothesis ? (
            <button
              type="button"
              className="link-button"
              onClick={() => onOpenHypothesis(hypothesis.id)}
            >
              Hypothesis: {hypothesis.title}
            </button>
          ) : null}
          {claim ? (
            <p>
              <ClaimKindBadge kind={claim.kind} /> {claim.text}
              {claim.attribution ? <span className="muted"> — {claim.attribution}</span> : null}
            </p>
          ) : null}
          <p className="muted">
            {source ? (
              onOpenSource ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onOpenSource(source.id)}
                >
                  Source: {source.title}
                </button>
              ) : (
                <>Source: {source.title}</>
              )
            ) : (
              'No source recorded'
            )}
            {event ? (
              <>
                {' · Event: '}
                {onOpenEvent ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onOpenEvent(event.id)}
                  >
                    {event.title}
                  </button>
                ) : (
                  event.title
                )}
              </>
            ) : null}
          </p>
          <p className="wt-explanation">Reason: {link.explanation}</p>
        </li>
      ))}
    </ul>
  );
}

export function RelationGroups({
  byRelation,
  ...handlers
}: {
  byRelation: Record<LinkRelation, EvidenceItem[]>;
  onOpenEvent?: (id: number) => void;
  onOpenSource?: (id: number) => void;
}) {
  return (
    <div className="wt-relations">
      {LINK_RELATIONS.map((relation) => (
        <section key={relation} aria-labelledby={`rel-${relation}`} className="wt-relation">
          <h4 id={`rel-${relation}`}>
            {RELATION_LABEL[relation]} <span className="count">{byRelation[relation].length}</span>
          </h4>
          {byRelation[relation].length === 0 ? (
            <p className="muted">None linked.</p>
          ) : (
            <EvidenceList items={byRelation[relation]} {...handlers} />
          )}
        </section>
      ))}
    </div>
  );
}

export function PaneHeader({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="note-header">
      <h2>{title}</h2>
      {badge ? <p className="note-meta">{badge}</p> : null}
      {children}
    </header>
  );
}

export function TimelineList({
  entries,
  onOpenEvent,
  onOpenHypothesis,
}: {
  entries: TimelineEntry[];
  onOpenEvent: (id: number) => void;
  onOpenHypothesis: (id: number) => void;
}) {
  const dated = entries.filter((entry) => entry.event.eventDate !== null);
  const undated = entries.filter((entry) => entry.event.eventDate === null);
  const row = (entry: TimelineEntry) => (
    <li key={entry.event.id} className="wt-timeline-item">
      <p className="wt-timeline-date">
        <time>{eventDateLabel(entry.event)}</time>
        {entry.event.datePrecision ? (
          <span className="muted"> · {PRECISION_LABEL[entry.event.datePrecision]}</span>
        ) : null}
      </p>
      <button
        type="button"
        className="link-button wt-timeline-title"
        onClick={() => onOpenEvent(entry.event.id)}
      >
        {entry.event.title}
      </button>
      <p className="wt-timeline-counts">
        {entry.claimTotal === 0 ? (
          <span className="muted">No statements yet</span>
        ) : (
          CLAIM_KINDS.filter((kind) => entry.claimCounts[kind] > 0).map((kind) => (
            <span key={kind} className={`kind-badge kind-${kind}`}>
              {CLAIM_KIND_LABEL[kind]} {entry.claimCounts[kind]}
            </span>
          ))
        )}
      </p>
      {entry.hypotheses.length > 0 ? (
        <p className="muted">
          Hypotheses:{' '}
          {entry.hypotheses.map((h) => (
            <button
              key={h.id}
              type="button"
              className="link-button"
              onClick={() => onOpenHypothesis(h.id)}
            >
              {h.title} ({STATUS_LABEL[h.status]})
            </button>
          ))}
        </p>
      ) : null}
    </li>
  );
  return (
    <div>
      <ol className="wt-timeline" aria-label="Events by event date, oldest first">
        {dated.map(row)}
      </ol>
      {undated.length > 0 ? (
        <>
          <h3 className="wt-undated-heading">Undated events</h3>
          <p className="muted">
            No event date was entered, so these cannot be placed on the timeline.
          </p>
          <ul className="wt-timeline" aria-label="Undated events">
            {undated.map(row)}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function availabilityText(source: ResearchSource): string {
  return AVAILABILITY_LABEL[source.documentId === null ? 'metadata_only' : 'archived_copy'];
}
