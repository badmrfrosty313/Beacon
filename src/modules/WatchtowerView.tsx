import { useCallback, useEffect, useState } from 'react';

import { useApi } from '../api/ApiContext';
import { errorMessage } from '../api/errors';
import {
  CLAIM_KINDS,
  HYPOTHESIS_STATUSES,
  type ClaimKind,
  type DocumentSummary,
  type HypothesisStatus,
  type WatchtowerSnapshot,
} from '../api/types';
import {
  AVAILABILITY_LABEL,
  CLAIM_KIND_LABEL,
  STATUS_LABEL,
  buildTimeline,
  eventDateLabel,
  eventDetail,
  filterTimeline,
  hypothesisDetail,
  sourceDetail,
  PRECISION_LABEL,
} from '../lib/watchtower/model';
import {
  ClaimItem,
  EvidenceList,
  PaneHeader,
  RelationGroups,
  ScriptureRef,
  TimelineList,
} from './watchtower/details';
import { SelectField } from './watchtower/fields';
import { ClaimForm, EventForm, HypothesisForm, LinkForm, SourceForm } from './watchtower/forms';

type Tab = 'timeline' | 'events' | 'sources' | 'hypotheses';
type Pane =
  | { kind: 'none' }
  | { kind: 'new'; what: 'event' | 'source' | 'hypothesis' }
  | { kind: 'event' | 'source' | 'hypothesis'; id: number; editing?: boolean };

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'events', label: 'Events' },
  { id: 'sources', label: 'Sources' },
  { id: 'hypotheses', label: 'Hypotheses' },
];

const NEW_LABEL: Record<
  'events' | 'sources' | 'hypotheses',
  [string, 'event' | 'source' | 'hypothesis']
> = {
  events: ['New event', 'event'],
  sources: ['New source', 'source'],
  hypotheses: ['New hypothesis', 'hypothesis'],
};

export function WatchtowerView({
  onOpenScripture,
  onOpenArchive,
}: {
  onOpenScripture?: (reference: string) => void;
  onOpenArchive?: () => void;
}) {
  const api = useApi();
  const [snapshot, setSnapshot] = useState<WatchtowerSnapshot | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('timeline');
  const [pane, setPane] = useState<Pane>({ kind: 'none' });
  const [kindFilter, setKindFilter] = useState<ClaimKind | ''>('');
  const [statusFilter, setStatusFilter] = useState<HypothesisStatus | ''>('');

  const reload = useCallback(async () => {
    try {
      const [next, docs] = await Promise.all([api.getWatchtower(), api.listDocuments()]);
      setSnapshot(next);
      setDocuments(docs);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function open(kind: 'event' | 'source' | 'hypothesis', id: number) {
    setPane({ kind, id });
    setTab(kind === 'event' ? 'events' : kind === 'source' ? 'sources' : 'hypotheses');
  }

  async function saved(next: Pane) {
    await reload();
    setPane(next);
  }

  if (loadError !== null) {
    return (
      <section className="view" aria-labelledby="wt-title">
        <h1 id="wt-title">Watchtower</h1>
        <p role="alert" className="banner banner-error">
          {loadError}
        </p>
        <button type="button" className="button" onClick={() => void reload()}>
          Try again
        </button>
      </section>
    );
  }
  if (snapshot === null) {
    return (
      <section className="view" aria-labelledby="wt-title">
        <h1 id="wt-title">Watchtower</h1>
        <p className="muted">Loading your research records…</p>
      </section>
    );
  }

  const timeline = filterTimeline(buildTimeline(snapshot), {
    kind: kindFilter === '' ? null : kindFilter,
    status: statusFilter === '' ? null : statusFilter,
  });

  function renderList() {
    if (snapshot === null) return null;
    if (tab === 'timeline') {
      return (
        <>
          <div className="wt-filters">
            <SelectField
              label="Show events with this kind of statement"
              value={kindFilter}
              onChange={(value) => setKindFilter(value as ClaimKind | '')}
              options={[
                { value: '', label: 'Any' },
                ...CLAIM_KINDS.map((k) => ({ value: k, label: CLAIM_KIND_LABEL[k] })),
              ]}
            />
            <SelectField
              label="Show events related to hypotheses that are"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as HypothesisStatus | '')}
              options={[
                { value: '', label: 'Any status' },
                ...HYPOTHESIS_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
              ]}
            />
          </div>
          {snapshot.events.length === 0 ? (
            <p className="empty-state">
              No events yet. Create an event with a date to start a timeline.
            </p>
          ) : timeline.length === 0 ? (
            <p className="empty-state">No events match these filters.</p>
          ) : (
            <TimelineList
              entries={timeline}
              onOpenEvent={(id) => open('event', id)}
              onOpenHypothesis={(id) => open('hypothesis', id)}
            />
          )}
        </>
      );
    }
    const rows =
      tab === 'events'
        ? snapshot.events.map((e) => ({
            id: e.id,
            kind: 'event' as const,
            title: e.title,
            meta: eventDateLabel(e),
          }))
        : tab === 'sources'
          ? snapshot.sources.map((s) => ({
              id: s.id,
              kind: 'source' as const,
              title: s.title,
              meta: AVAILABILITY_LABEL[s.documentId === null ? 'metadata_only' : 'archived_copy'],
            }))
          : snapshot.hypotheses.map((h) => ({
              id: h.id,
              kind: 'hypothesis' as const,
              title: h.title,
              meta: STATUS_LABEL[h.status],
            }));
    const [newLabel, newWhat] = NEW_LABEL[tab];
    return (
      <>
        <button
          type="button"
          className="button button-primary"
          onClick={() => setPane({ kind: 'new', what: newWhat })}
        >
          {newLabel}
        </button>
        {rows.length === 0 ? (
          <p className="empty-state">Nothing here yet.</p>
        ) : (
          <ul className="note-list">
            {rows.map((row) => (
              <li key={`${row.kind}-${row.id}`}>
                <button
                  type="button"
                  className={
                    pane.kind === row.kind && 'id' in pane && pane.id === row.id
                      ? 'note-item note-item-active'
                      : 'note-item'
                  }
                  onClick={() => open(row.kind, row.id)}
                >
                  <span className="note-item-title">{row.title}</span>
                  <span className="note-item-date">{row.meta}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  function renderPane() {
    if (snapshot === null) return null;

    if (pane.kind === 'new') {
      const cancel = () => setPane({ kind: 'none' });
      if (pane.what === 'event') {
        return (
          <EventForm
            api={api}
            onCancel={cancel}
            onDone={(e) => void saved({ kind: 'event', id: e.id })}
          />
        );
      }
      if (pane.what === 'source') {
        return (
          <SourceForm
            api={api}
            documents={documents}
            onCancel={cancel}
            onDone={(s) => void saved({ kind: 'source', id: s.id })}
          />
        );
      }
      return (
        <HypothesisForm
          api={api}
          onCancel={cancel}
          onDone={(h) => void saved({ kind: 'hypothesis', id: h.id })}
        />
      );
    }

    if (pane.kind === 'event') {
      const detail = eventDetail(snapshot, pane.id);
      if (detail === null) return <p className="empty-state">That event could not be found.</p>;
      if (pane.editing) {
        return (
          <EventForm
            key={detail.event.id}
            api={api}
            initial={detail.event}
            onCancel={() => setPane({ kind: 'event', id: pane.id })}
            onDone={() => void saved({ kind: 'event', id: pane.id })}
          />
        );
      }
      const { event } = detail;
      return (
        <article aria-label={`Event: ${event.title}`}>
          <PaneHeader
            title={event.title}
            badge={
              <>
                Event date: <strong>{eventDateLabel(event)}</strong>
                {event.datePrecision ? ` (${PRECISION_LABEL[event.datePrecision]})` : ''}
              </>
            }
          >
            <p className="muted">Record created {event.createdAt}</p>
          </PaneHeader>
          {event.description ? <p className="note-body">{event.description}</p> : null}
          <button
            type="button"
            className="button"
            onClick={() => setPane({ kind: 'event', id: pane.id, editing: true })}
          >
            Edit event
          </button>
          <h3>Statements</h3>
          {detail.claims.length === 0 ? (
            <p className="muted">No statements yet.</p>
          ) : (
            <ul className="plain-list wt-claims">
              {detail.claims.map(({ claim, source }) => (
                <ClaimItem
                  key={claim.id}
                  claim={claim}
                  source={source}
                  onOpenScripture={onOpenScripture}
                />
              ))}
            </ul>
          )}
          <ClaimForm
            key={event.id}
            api={api}
            eventId={event.id}
            sources={snapshot.sources}
            onDone={() => void reload()}
          />
          <h3>Evidence links involving this event</h3>
          {detail.evidence.length === 0 ? (
            <p className="muted">No evidence has been linked to a hypothesis yet.</p>
          ) : (
            <EvidenceList
              items={detail.evidence}
              onOpenHypothesis={(id) => open('hypothesis', id)}
              onOpenSource={(id) => open('source', id)}
            />
          )}
        </article>
      );
    }

    if (pane.kind === 'source') {
      const detail = sourceDetail(snapshot, pane.id);
      if (detail === null) return <p className="empty-state">That source could not be found.</p>;
      if (pane.editing) {
        return (
          <SourceForm
            key={detail.source.id}
            api={api}
            documents={documents}
            initial={detail.source}
            onCancel={() => setPane({ kind: 'source', id: pane.id })}
            onDone={() => void saved({ kind: 'source', id: pane.id })}
          />
        );
      }
      const { source } = detail;
      const doc = documents.find((d) => d.id === source.documentId);
      return (
        <article aria-label={`Source: ${source.title}`}>
          <PaneHeader
            title={source.title}
            badge={
              <span
                className={
                  detail.availability === 'archived_copy'
                    ? 'availability availability-copy'
                    : 'availability availability-meta'
                }
              >
                {AVAILABILITY_LABEL[detail.availability]}
              </span>
            }
          />
          <dl className="doc-meta">
            <dt>Author</dt>
            <dd>{source.author ?? 'Not stated'}</dd>
            <dt>Publisher</dt>
            <dd>{source.publisher ?? 'Not stated'}</dd>
            <dt>Address (text only, never opened)</dt>
            <dd className="mono">{source.url ?? 'None'}</dd>
            <dt>Published</dt>
            <dd>{source.publishedDate ?? 'Not stated'}</dd>
            <dt>Retrieved</dt>
            <dd>{source.retrievedDate ?? 'Not stated'}</dd>
            <dt>Record created</dt>
            <dd>{source.createdAt}</dd>
            <dt>Archive copy</dt>
            <dd>
              {source.documentId === null ? 'None' : (doc?.title ?? 'A linked Archive document')}
              {source.documentId !== null && onOpenArchive ? (
                <>
                  {' '}
                  <button type="button" className="link-button" onClick={onOpenArchive}>
                    Open Archive
                  </button>
                </>
              ) : null}
            </dd>
          </dl>
          {source.note ? <p className="note-body">{source.note}</p> : null}
          <button
            type="button"
            className="button"
            onClick={() => setPane({ kind: 'source', id: pane.id, editing: true })}
          >
            Edit source
          </button>
          <h3>Statements citing this source</h3>
          {detail.claims.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <ul className="plain-list wt-claims">
              {detail.claims.map((claim) => (
                <ClaimItem key={claim.id} claim={claim} source={source} />
              ))}
            </ul>
          )}
          <h3>Evidence links using this source</h3>
          {detail.evidence.length === 0 ? (
            <p className="muted">None yet.</p>
          ) : (
            <EvidenceList
              items={detail.evidence}
              onOpenHypothesis={(id) => open('hypothesis', id)}
              onOpenEvent={(id) => open('event', id)}
            />
          )}
        </article>
      );
    }

    if (pane.kind === 'hypothesis') {
      const detail = hypothesisDetail(snapshot, pane.id);
      if (detail === null) {
        return <p className="empty-state">That hypothesis could not be found.</p>;
      }
      const { hypothesis } = detail;
      if (pane.editing) {
        return (
          <HypothesisForm
            key={hypothesis.id}
            api={api}
            initial={hypothesis}
            onCancel={() => setPane({ kind: 'hypothesis', id: pane.id })}
            onDone={() => void saved({ kind: 'hypothesis', id: pane.id })}
          />
        );
      }
      const changeStatus = async (status: HypothesisStatus) => {
        try {
          await api.updateHypothesis(hypothesis.id, {
            title: hypothesis.title,
            statement: hypothesis.statement,
            scriptureReference: hypothesis.scriptureReference,
            status,
          });
          await reload();
        } catch (error) {
          setLoadError(errorMessage(error));
        }
      };
      return (
        <article aria-label={`Hypothesis: ${hypothesis.title}`}>
          <PaneHeader
            title={hypothesis.title}
            badge={
              <>
                Status: <strong>{STATUS_LABEL[hypothesis.status]}</strong> · a proposition, not a
                finding
              </>
            }
          />
          <p className="note-body">{hypothesis.statement}</p>
          <ScriptureRef reference={hypothesis.scriptureReference} onOpen={onOpenScripture} />
          <div className="form-actions">
            <button
              type="button"
              className="button"
              onClick={() => setPane({ kind: 'hypothesis', id: pane.id, editing: true })}
            >
              Edit hypothesis
            </button>
            {hypothesis.status !== 'set_aside' ? (
              <button
                type="button"
                className="button"
                onClick={() => void changeStatus('set_aside')}
              >
                Set aside
              </button>
            ) : (
              <button type="button" className="button" onClick={() => void changeStatus('open')}>
                Reopen
              </button>
            )}
            {hypothesis.status === 'open' ? (
              <button
                type="button"
                className="button"
                onClick={() => void changeStatus('under_review')}
              >
                Mark under review
              </button>
            ) : null}
          </div>
          <h3>Evidence</h3>
          <p className="muted">
            Supporting and contradicting evidence are both shown. BEACON does not weigh or score
            them.
          </p>
          <RelationGroups
            byRelation={detail.byRelation}
            onOpenEvent={(id) => open('event', id)}
            onOpenSource={(id) => open('source', id)}
          />
          <LinkForm
            key={hypothesis.id}
            api={api}
            hypothesisId={hypothesis.id}
            snapshot={snapshot}
            onDone={() => void reload()}
          />
        </article>
      );
    }

    return (
      <p className="empty-state">Select an item, or create a new event, source or hypothesis.</p>
    );
  }

  return (
    <section className="view" aria-labelledby="wt-title">
      <header className="view-header">
        <div>
          <h1 id="wt-title">Watchtower</h1>
          <p className="view-subtitle">
            A private research workspace for events, sources, hypotheses and the evidence between
            them. It is not an alert system, and nothing here is verified by BEACON.
          </p>
        </div>
        <span className="pill pill-demo">Private · stored only on this device</span>
      </header>
      <div role="group" aria-label="Watchtower sections" className="section-switch">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={tab === item.id}
            className="button"
            onClick={() => {
              setTab(item.id);
              setPane({ kind: 'none' });
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="archive-layout">
        <div className="note-list-panel">{renderList()}</div>
        <div className="archive-pane">{renderPane()}</div>
      </div>
    </section>
  );
}
