import { useState, type FormEvent, type ReactNode } from 'react';

import type { BeaconApi } from '../../api/beaconApi';
import {
  CLAIM_KINDS,
  HYPOTHESIS_STATUSES,
  LINK_RELATIONS,
  type ClaimKind,
  type DocumentSummary,
  type HypothesisStatus,
  type LinkRelation,
  type ResearchEvent,
  type ResearchHypothesis,
  type ResearchSource,
  type WatchtowerSnapshot,
} from '../../api/types';
import {
  CLAIM_KIND_HINT,
  CLAIM_KIND_LABEL,
  RELATION_LABEL,
  STATUS_LABEL,
  preview,
} from '../../lib/watchtower/model';
import {
  FormError,
  SelectField,
  TextAreaField,
  TextField,
  blankToNull,
  canonicalReference,
  useSubmit,
} from './fields';

interface FormShellProps {
  title: string;
  submitLabel: string;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
  children: ReactNode;
}

function FormShell({ title, submitLabel, onSubmit, onCancel, children }: FormShellProps) {
  const { error, busy, run } = useSubmit();
  function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(onSubmit);
  }
  return (
    <form className="note-form wt-form" onSubmit={handle} noValidate aria-label={title}>
      <h3>{title}</h3>
      {children}
      <FormError message={error} />
      <div className="form-actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

// ---- Event --------------------------------------------------------------------------------

export function EventForm({
  api,
  initial,
  onDone,
  onCancel,
}: {
  api: BeaconApi;
  initial?: ResearchEvent;
  onDone: (event: ResearchEvent) => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [eventDate, setEventDate] = useState(initial?.eventDate ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  return (
    <FormShell
      title={initial ? 'Edit event' : 'New event'}
      submitLabel={initial ? 'Save event' : 'Create event'}
      onCancel={onCancel}
      onSubmit={async () => {
        const input = {
          title,
          eventDate: blankToNull(eventDate),
          description: blankToNull(description),
        };
        onDone(initial ? await api.updateEvent(initial.id, input) : await api.createEvent(input));
      }}
    >
      <TextField label="Event title" value={title} onChange={setTitle} />
      <TextField
        label="Event date"
        value={eventDate}
        onChange={setEventDate}
        hint="When it happened, not when you read about it. Use 2026, 2026-03, 2026-03-10 or 2026-03-10T14:30-05:00 (a time needs its UTC offset, or Z). Leave blank if unknown; BEACON will not guess."
      />
      <TextAreaField label="Description (optional)" value={description} onChange={setDescription} />
    </FormShell>
  );
}

// ---- Source -------------------------------------------------------------------------------

export function SourceForm({
  api,
  documents,
  initial,
  onDone,
  onCancel,
}: {
  api: BeaconApi;
  documents: DocumentSummary[];
  initial?: ResearchSource;
  onDone: (source: ResearchSource) => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [author, setAuthor] = useState(initial?.author ?? '');
  const [publisher, setPublisher] = useState(initial?.publisher ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [published, setPublished] = useState(initial?.publishedDate ?? '');
  const [retrieved, setRetrieved] = useState(initial?.retrievedDate ?? '');
  const [documentId, setDocumentId] = useState(
    initial?.documentId === null || initial?.documentId === undefined
      ? ''
      : String(initial.documentId),
  );
  const [note, setNote] = useState(initial?.note ?? '');
  return (
    <FormShell
      title={initial ? 'Edit source' : 'New source'}
      submitLabel={initial ? 'Save source' : 'Create source'}
      onCancel={onCancel}
      onSubmit={async () => {
        const input = {
          title,
          author: blankToNull(author),
          publisher: blankToNull(publisher),
          url: blankToNull(url),
          publishedDate: blankToNull(published),
          retrievedDate: blankToNull(retrieved),
          documentId: documentId === '' ? null : Number(documentId),
          note: blankToNull(note),
        };
        onDone(initial ? await api.updateSource(initial.id, input) : await api.createSource(input));
      }}
    >
      <p className="muted">
        A source is a record of where something came from. BEACON never visits the address you
        enter. To keep an offline copy, import the text in the Archive and link it below.
      </p>
      <TextField label="Source title" value={title} onChange={setTitle} />
      <TextField label="Author (optional)" value={author} onChange={setAuthor} />
      <TextField label="Publisher (optional)" value={publisher} onChange={setPublisher} />
      <TextField
        label="Address (URL, optional)"
        value={url}
        onChange={setUrl}
        hint="Stored as text only. It is not opened or downloaded, and it is not a preserved copy."
      />
      <TextField
        label="Published date (optional)"
        value={published}
        onChange={setPublished}
        hint="When the source says it was published: YYYY, YYYY-MM or YYYY-MM-DD."
      />
      <TextField
        label="Retrieved date (optional)"
        value={retrieved}
        onChange={setRetrieved}
        hint="When you looked at it: YYYY, YYYY-MM or YYYY-MM-DD."
      />
      <SelectField
        label="Preserved copy in the Archive (optional)"
        value={documentId}
        onChange={setDocumentId}
        options={[
          { value: '', label: 'None — metadata only' },
          ...documents.map((doc) => ({ value: String(doc.id), label: doc.title })),
        ]}
      />
      <TextAreaField label="Note (optional)" value={note} onChange={setNote} />
    </FormShell>
  );
}

// ---- Claim --------------------------------------------------------------------------------

export function ClaimForm({
  api,
  eventId,
  sources,
  onDone,
}: {
  api: BeaconApi;
  eventId: number;
  sources: ResearchSource[];
  onDone: () => void;
}) {
  const [kind, setKind] = useState<ClaimKind>('observation');
  const [text, setText] = useState('');
  const [attribution, setAttribution] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [reference, setReference] = useState('');
  return (
    <FormShell
      title="Add a statement to this event"
      submitLabel="Add statement"
      onSubmit={async () => {
        const scriptureReference = await canonicalReference(api, reference);
        await api.createClaim({
          eventId,
          sourceId: sourceId === '' ? null : Number(sourceId),
          kind,
          text,
          attribution: blankToNull(attribution),
          scriptureReference,
        });
        setText('');
        setAttribution('');
        setReference('');
        onDone();
      }}
    >
      <SelectField
        label="What kind of statement is this?"
        value={kind}
        onChange={(value) => setKind(value as ClaimKind)}
        hint={CLAIM_KIND_HINT[kind]}
        options={CLAIM_KINDS.map((value) => ({ value, label: CLAIM_KIND_LABEL[value] }))}
      />
      <TextAreaField label="Statement" value={text} onChange={setText} />
      <TextField
        label={kind === 'attributed_claim' ? 'Attribution (required)' : 'Attribution (optional)'}
        value={attribution}
        onChange={setAttribution}
        hint="Who said it, or who holds this view."
      />
      <SelectField
        label="Source (optional)"
        value={sourceId}
        onChange={setSourceId}
        options={[
          { value: '', label: 'No source recorded' },
          ...sources.map((source) => ({ value: String(source.id), label: source.title })),
        ]}
      />
      <TextField
        label="Scripture reference (optional)"
        value={reference}
        onChange={setReference}
        hint="For example Rev 13:16-18. Checked against the packaged text; saved in its full form."
      />
    </FormShell>
  );
}

// ---- Hypothesis ---------------------------------------------------------------------------

export function HypothesisForm({
  api,
  initial,
  onDone,
  onCancel,
}: {
  api: BeaconApi;
  initial?: ResearchHypothesis;
  onDone: (hypothesis: ResearchHypothesis) => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [statement, setStatement] = useState(initial?.statement ?? '');
  const [status, setStatus] = useState<HypothesisStatus>(initial?.status ?? 'open');
  const [reference, setReference] = useState(initial?.scriptureReference ?? '');
  return (
    <FormShell
      title={initial ? 'Edit hypothesis' : 'New hypothesis'}
      submitLabel={initial ? 'Save hypothesis' : 'Create hypothesis'}
      onCancel={onCancel}
      onSubmit={async () => {
        const scriptureReference = await canonicalReference(api, reference);
        const input = { title, statement, status, scriptureReference };
        onDone(
          initial
            ? await api.updateHypothesis(initial.id, input)
            : await api.createHypothesis(input),
        );
      }}
    >
      <p className="muted">
        A hypothesis is a proposition you are testing. It is not a finding, and linking evidence
        never changes its status for you.
      </p>
      <TextField label="Hypothesis title" value={title} onChange={setTitle} />
      <TextAreaField label="Proposition" value={statement} onChange={setStatement} />
      <SelectField
        label="Status"
        value={status}
        onChange={(value) => setStatus(value as HypothesisStatus)}
        options={HYPOTHESIS_STATUSES.map((value) => ({ value, label: STATUS_LABEL[value] }))}
      />
      <TextField
        label="Scripture reference (optional)"
        value={reference}
        onChange={setReference}
        hint="Checked against the packaged text; saved in its full form."
      />
    </FormShell>
  );
}

// ---- Evidence link ------------------------------------------------------------------------

export function LinkForm({
  api,
  hypothesisId,
  snapshot,
  onDone,
}: {
  api: BeaconApi;
  hypothesisId: number;
  snapshot: WatchtowerSnapshot;
  onDone: () => void;
}) {
  const [relation, setRelation] = useState<LinkRelation>('supports');
  const [evidence, setEvidence] = useState('');
  const [eventId, setEventId] = useState('');
  const [explanation, setExplanation] = useState('');
  const eventTitles = new Map(snapshot.events.map((e) => [e.id, e.title]));
  const isSource = evidence.startsWith('source:');

  return (
    <FormShell
      title="Link evidence to this hypothesis"
      submitLabel="Link evidence"
      onSubmit={async () => {
        const [type, rawId] = evidence.split(':');
        await api.createEvidenceLink({
          hypothesisId,
          relation,
          claimId: type === 'claim' ? Number(rawId) : null,
          sourceId: type === 'source' ? Number(rawId) : null,
          eventId: type === 'source' && eventId !== '' ? Number(eventId) : null,
          explanation,
        });
        setEvidence('');
        setEventId('');
        setExplanation('');
        onDone();
      }}
    >
      <SelectField
        label="Relationship"
        value={relation}
        onChange={(value) => setRelation(value as LinkRelation)}
        options={LINK_RELATIONS.map((value) => ({ value, label: RELATION_LABEL[value] }))}
        hint="Supports and contradicts are both kept. Context is background that is neither."
      />
      <SelectField
        label="Evidence"
        value={evidence}
        onChange={setEvidence}
        options={[
          { value: '', label: 'Choose a statement or a source…' },
          ...snapshot.claims.map((claim) => ({
            value: `claim:${claim.id}`,
            label: `Statement (${CLAIM_KIND_LABEL[claim.kind]}): ${preview(claim.text, 50)} — ${
              eventTitles.get(claim.eventId) ?? 'event'
            }`,
          })),
          ...snapshot.sources.map((source) => ({
            value: `source:${source.id}`,
            label: `Source: ${source.title}`,
          })),
        ]}
      />
      {isSource ? (
        <SelectField
          label="About which event? (optional)"
          value={eventId}
          onChange={setEventId}
          options={[
            { value: '', label: 'Not tied to an event' },
            ...snapshot.events.map((e) => ({ value: String(e.id), label: e.title })),
          ]}
        />
      ) : null}
      <TextAreaField
        label="Why does it relate this way?"
        value={explanation}
        onChange={setExplanation}
        hint="A short explanation is required so anyone can review the reasoning."
      />
    </FormShell>
  );
}
