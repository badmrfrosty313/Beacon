import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import {
  CLAIM_KINDS,
  LINK_RELATIONS,
  type ClaimKind,
  type ImportedDocument,
  type ImportedLinks,
  type LinkRelation,
  type WatchtowerSnapshot,
} from '../../api/types';
import { CLAIM_KIND_HINT, CLAIM_KIND_LABEL, RELATION_LABEL } from '../../lib/watchtower/model';
import {
  ClaimKindBadge,
  FormError,
  SelectField,
  TextAreaField,
  TextField,
  blankToNull,
  useSubmit,
} from '../watchtower/fields';

const NEW_EVENT = 'new';

/**
 * Explicit, owner-approved mapping of an imported document into Watchtower. Nothing happens
 * automatically: each step is a deliberate form, the person chooses the classification (there
 * is no default), and no confidence or probability is ever computed. A pasted excerpt is
 * recorded as a statement of the kind the person chooses; it is never presented as a verified
 * observation unless they classify it so.
 */
export function MappingPanel({ doc }: { doc: ImportedDocument }) {
  const api = useApi();
  const [snapshot, setSnapshot] = useState<WatchtowerSnapshot | null>(null);
  const [links, setLinks] = useState<ImportedLinks | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [wt, ls] = await Promise.all([api.getWatchtower(), api.getResearchLinks()]);
      setSnapshot(wt);
      setLinks(ls);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="banner banner-error" role="alert">
        <p>{error}</p>
        <button type="button" className="button" onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }
  if (!snapshot || !links) {
    return (
      <p className="muted pad" role="status">
        Loading Watchtower…
      </p>
    );
  }

  const linkedSourceIds = links.sourceLinks
    .filter((link) => link.researchDocumentId === doc.id)
    .map((link) => link.sourceId);
  const linkedSources = snapshot.sources.filter((source) => linkedSourceIds.includes(source.id));
  const excerpts = links.excerpts.filter((excerpt) => excerpt.researchDocumentId === doc.id);

  return (
    <section className="form-section" aria-labelledby="mapping-heading">
      <h3 id="mapping-heading">Map into Watchtower</h3>
      <p className="muted">
        Optional and entirely your decision. Nothing is created automatically, and nothing here
        decides what is true: you choose how each excerpt is classified, and you can leave it
        unmapped.
      </p>

      <h4>Sources made from this document</h4>
      {linkedSources.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul aria-label="Linked Watchtower sources">
          {linkedSources.map((source) => (
            <li key={source.id}>{source.title}</li>
          ))}
        </ul>
      )}
      <SourceForm doc={doc} onDone={load} />

      <h4>Excerpts recorded from this document</h4>
      {excerpts.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul aria-label="Recorded excerpts">
          {excerpts.map((excerpt) => {
            const claim = snapshot.claims.find((c) => c.id === excerpt.claimId);
            return (
              <li key={excerpt.id}>
                {claim ? <ClaimKindBadge kind={claim.kind} /> : null}{' '}
                {excerpt.location ? <span>({excerpt.location}) </span> : null}
                <span>{claim?.text ?? ''}</span>
              </li>
            );
          })}
        </ul>
      )}
      {linkedSources.length === 0 ? (
        <p className="muted">Create a source above before recording an excerpt.</p>
      ) : (
        <>
          <ExcerptForm
            doc={doc}
            snapshot={snapshot}
            linkedSources={linkedSources.map((s) => ({ id: s.id, title: s.title }))}
            onDone={load}
          />
          <SourceEvidenceForm
            snapshot={snapshot}
            linkedSources={linkedSources.map((s) => ({ id: s.id, title: s.title }))}
            onDone={load}
          />
        </>
      )}
    </section>
  );
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function SourceForm({ doc, onDone }: { doc: ImportedDocument; onDone: () => Promise<void> }) {
  const api = useApi();
  const { error, busy, run } = useSubmit();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [author, setAuthor] = useState(doc.author ?? '');
  const [publisher, setPublisher] = useState(doc.publisher ?? '');
  const [published, setPublished] = useState(doc.publishedDate ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="button" onClick={() => setOpen(true)}>
        Create a Watchtower source from this document
      </button>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(async () => {
      const source = await api.createSource({
        title,
        author: blankToNull(author),
        publisher: blankToNull(publisher),
        publishedDate: blankToNull(published),
        retrievedDate: today(),
        note: `Imported from a private research document. SHA-256 ${doc.sha256}.`,
      });
      await api.linkResearchSource(doc.id, source.id);
    });
    if (ok) {
      setDone(`Created source “${title}” and linked it to this document.`);
      setOpen(false);
      setConfirmed(false);
      await onDone();
    }
  }

  return (
    <form onSubmit={submit} aria-label="Create source from document">
      <TextField label="Source title" value={title} maxLength={200} onChange={setTitle} />
      <TextField label="Author" value={author} onChange={setAuthor} />
      <TextField label="Publisher or source" value={publisher} onChange={setPublisher} />
      <TextField
        label="Date written or published"
        value={published}
        hint="The document’s own date. The retrieved date is recorded as today."
        onChange={setPublished}
      />
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{' '}
        I confirm creating this source in Watchtower
      </label>
      <FormError message={error} />
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={busy || !confirmed}>
          Create source and link it
        </button>
        <button type="button" className="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {done ? <p role="status">{done}</p> : null}
    </form>
  );
}

function ExcerptForm({
  doc,
  snapshot,
  linkedSources,
  onDone,
}: {
  doc: ImportedDocument;
  snapshot: WatchtowerSnapshot;
  linkedSources: Array<{ id: number; title: string }>;
  onDone: () => Promise<void>;
}) {
  const api = useApi();
  const { error, busy, run } = useSubmit();
  const [sourceId, setSourceId] = useState('');
  const [eventId, setEventId] = useState('');
  const [newEventTitle, setNewEventTitle] = useState('');
  const [kind, setKind] = useState('');
  const [text, setText] = useState('');
  const [attribution, setAttribution] = useState('');
  const [location, setLocation] = useState('');
  const [hypothesisId, setHypothesisId] = useState('');
  const [relation, setRelation] = useState<LinkRelation>('supports');
  const [explanation, setExplanation] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(null);
    const ok = await run(async () => {
      if (sourceId === '' || eventId === '' || kind === '') {
        throw new Error('Choose a source, an event and a classification before saving.');
      }
      let resolvedEvent = Number(eventId);
      if (eventId === NEW_EVENT) {
        resolvedEvent = (await api.createEvent({ title: newEventTitle })).id;
      }
      const claim = await api.createClaim({
        eventId: resolvedEvent,
        sourceId: Number(sourceId),
        kind: kind as ClaimKind,
        text,
        attribution: blankToNull(attribution),
      });
      await api.linkResearchExcerpt(doc.id, claim.id, location);
      if (hypothesisId !== '') {
        await api.createEvidenceLink({
          hypothesisId: Number(hypothesisId),
          relation,
          claimId: claim.id,
          explanation,
        });
      }
    });
    if (ok) {
      setDone('Excerpt recorded as you classified it.');
      setText('');
      setAttribution('');
      setLocation('');
      setExplanation('');
      setConfirmed(false);
      await onDone();
    }
  }

  return (
    <form className="form-section" onSubmit={submit} aria-label="Record excerpt">
      <h4>Record a selected excerpt</h4>
      <SelectField
        label="Source"
        value={sourceId}
        onChange={setSourceId}
        options={[
          { value: '', label: 'Choose a source…' },
          ...linkedSources.map((s) => ({ value: String(s.id), label: s.title })),
        ]}
      />
      <SelectField
        label="Event"
        value={eventId}
        onChange={setEventId}
        options={[
          { value: '', label: 'Choose an event…' },
          ...snapshot.events.map((e) => ({ value: String(e.id), label: e.title })),
          { value: NEW_EVENT, label: 'Create a new event…' },
        ]}
      />
      {eventId === NEW_EVENT ? (
        <TextField
          label="New event title"
          value={newEventTitle}
          maxLength={200}
          onChange={setNewEventTitle}
        />
      ) : null}
      <SelectField
        label="How do you classify this excerpt?"
        value={kind}
        onChange={setKind}
        options={[
          { value: '', label: 'Choose a classification…' },
          ...CLAIM_KINDS.map((k) => ({ value: k, label: CLAIM_KIND_LABEL[k] })),
        ]}
        hint={
          kind === ''
            ? 'There is no default. A quote you pasted is not a verified observation unless you classify it as one.'
            : CLAIM_KIND_HINT[kind as ClaimKind]
        }
      />
      <TextAreaField
        label="Excerpt text"
        value={text}
        rows={4}
        hint="Copy the passage you want to keep. It is stored as your own record, separate from the document."
        onChange={setText}
      />
      <TextField
        label={kind === 'attributed_claim' ? 'Who made this claim (required)' : 'Attribution'}
        value={attribution}
        onChange={setAttribution}
      />
      <TextField
        label="Location in the document (optional)"
        value={location}
        hint="For example: page 3, or section 2. Not checked against the document."
        maxLength={100}
        onChange={setLocation}
      />
      <SelectField
        label="Attach to a hypothesis (optional)"
        value={hypothesisId}
        onChange={setHypothesisId}
        options={[
          { value: '', label: 'Do not attach' },
          ...snapshot.hypotheses.map((h) => ({ value: String(h.id), label: h.title })),
        ]}
      />
      {hypothesisId !== '' ? (
        <>
          <SelectField
            label="Relationship to the hypothesis"
            value={relation}
            onChange={(value) => setRelation(value as LinkRelation)}
            options={LINK_RELATIONS.map((r) => ({ value: r, label: RELATION_LABEL[r] }))}
          />
          <TextAreaField
            label="Why does it relate this way?"
            value={explanation}
            onChange={setExplanation}
          />
        </>
      ) : null}
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />{' '}
        I confirm this classification
      </label>
      <FormError message={error} />
      <button type="submit" className="button button-primary" disabled={busy || !confirmed}>
        Save excerpt
      </button>
      {done ? <p role="status">{done}</p> : null}
    </form>
  );
}

function SourceEvidenceForm({
  snapshot,
  linkedSources,
  onDone,
}: {
  snapshot: WatchtowerSnapshot;
  linkedSources: Array<{ id: number; title: string }>;
  onDone: () => Promise<void>;
}) {
  const api = useApi();
  const { error, busy, run } = useSubmit();
  const [sourceId, setSourceId] = useState('');
  const [hypothesisId, setHypothesisId] = useState('');
  const [relation, setRelation] = useState<LinkRelation>('supports');
  const [explanation, setExplanation] = useState('');
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(null);
    const ok = await run(async () => {
      if (sourceId === '' || hypothesisId === '') {
        throw new Error('Choose a source and a hypothesis.');
      }
      await api.createEvidenceLink({
        hypothesisId: Number(hypothesisId),
        relation,
        sourceId: Number(sourceId),
        explanation,
      });
    });
    if (ok) {
      setDone('Source attached to the hypothesis.');
      setExplanation('');
      await onDone();
    }
  }

  return (
    <form className="form-section" onSubmit={submit} aria-label="Attach source to hypothesis">
      <h4>Attach a whole source to a hypothesis</h4>
      <SelectField
        label="Source to attach"
        value={sourceId}
        onChange={setSourceId}
        options={[
          { value: '', label: 'Choose a source…' },
          ...linkedSources.map((s) => ({ value: String(s.id), label: s.title })),
        ]}
      />
      <SelectField
        label="Hypothesis"
        value={hypothesisId}
        onChange={setHypothesisId}
        options={[
          { value: '', label: 'Choose a hypothesis…' },
          ...snapshot.hypotheses.map((h) => ({ value: String(h.id), label: h.title })),
        ]}
      />
      <SelectField
        label="Relationship"
        value={relation}
        onChange={(value) => setRelation(value as LinkRelation)}
        options={LINK_RELATIONS.map((r) => ({ value: r, label: RELATION_LABEL[r] }))}
      />
      <TextAreaField label="Why?" value={explanation} onChange={setExplanation} />
      <FormError message={error} />
      <button type="submit" className="button" disabled={busy}>
        Attach source
      </button>
      {done ? <p role="status">{done}</p> : null}
    </form>
  );
}
