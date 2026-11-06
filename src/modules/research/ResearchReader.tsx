import { useEffect, useState, type FormEvent } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import type { ImportedDocument, ResearchCollection } from '../../api/types';
import { formatBytes, formatTimestamp } from '../../lib/format';
import {
  FormError,
  SelectField,
  TextAreaField,
  TextField,
  blankToNull,
  useSubmit,
} from '../watchtower/fields';
import { MappingPanel } from './MappingPanel';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; doc: ImportedDocument };

const FORMAT_LABELS: Record<string, string> = {
  pdf: 'PDF (.pdf)',
  md: 'Markdown (.md)',
  txt: 'Plain text (.txt)',
};

/**
 * One imported document with its provenance. Opening it makes the backend re-verify the
 * preserved original's SHA-256; a failure is shown instead of the text. Text is untrusted and
 * rendered only as text.
 */
export function ResearchReader({
  id,
  collections,
  onChanged,
}: {
  id: number;
  collections: ResearchCollection[];
  onChanged: () => void;
}) {
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getResearch(id).then(
      (doc) => {
        if (!cancelled) setState({ status: 'ready', doc });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, id, revision]);

  if (state.status === 'loading') {
    return (
      <p className="muted pad" role="status">
        Opening and verifying the preserved original…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="banner banner-error" role="alert">
        <p>{state.message}</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            setState({ status: 'loading' });
            setRevision((n) => n + 1);
          }}
        >
          Retry document
        </button>
      </div>
    );
  }

  const { doc } = state;
  const collection = collections.find((c) => c.id === doc.collectionId);
  return (
    <article className="note" aria-labelledby="research-heading">
      <header className="note-header">
        <h2 id="research-heading">{doc.title}</h2>
        <p className="muted">Private to this device. Not published, synced or uploaded.</p>
        <dl className="doc-meta" aria-label="Provenance">
          <div>
            <dt>Collection</dt>
            <dd>{collection?.name ?? 'Unknown'}</dd>
          </div>
          <div>
            <dt>Original file name</dt>
            <dd>{doc.originalName}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{FORMAT_LABELS[doc.format] ?? doc.format}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(doc.byteLength)}</dd>
          </div>
          <div>
            <dt>SHA-256 fingerprint</dt>
            <dd>
              <code className="doc-hash">{doc.sha256}</code>
            </dd>
          </div>
          <div>
            <dt>Integrity</dt>
            <dd>Original re-checked against this fingerprint just now.</dd>
          </div>
          <div>
            <dt>Text extraction</dt>
            <dd>
              {doc.extractionMethod}
              {doc.pageCount !== null ? ` · ${doc.pageCount} pages` : ''}
              {doc.textTruncated ? ' · text was cut at the size limit' : ''}
            </dd>
          </div>
          {doc.author ? (
            <div>
              <dt>Author</dt>
              <dd>{doc.author}</dd>
            </div>
          ) : null}
          {doc.publisher ? (
            <div>
              <dt>Publisher or source</dt>
              <dd>{doc.publisher}</dd>
            </div>
          ) : null}
          {doc.publishedDate ? (
            <div>
              <dt>Date written or published</dt>
              <dd>{doc.publishedDate}</dd>
            </div>
          ) : null}
          <div>
            <dt>Imported</dt>
            <dd>
              <time dateTime={doc.importedAt}>{formatTimestamp(doc.importedAt)}</time>
            </dd>
          </div>
          {doc.attributionNote ? (
            <div>
              <dt>Attribution note</dt>
              <dd>{doc.attributionNote}</dd>
            </div>
          ) : null}
          {doc.rightsNote ? (
            <div>
              <dt>Rights and redistribution</dt>
              <dd>{doc.rightsNote}</dd>
            </div>
          ) : null}
        </dl>
        <button type="button" className="button" onClick={() => setEditing((value) => !value)}>
          {editing ? 'Close details editor' : 'Edit details'}
        </button>
      </header>

      {editing ? (
        <MetadataForm
          doc={doc}
          collections={collections}
          onSaved={() => {
            setEditing(false);
            setRevision((n) => n + 1);
            onChanged();
          }}
        />
      ) : null}

      <div className="doc-body" role="region" aria-label="Imported text" tabIndex={0}>
        {doc.body}
      </div>
      <p className="muted doc-footnote">
        {doc.format === 'pdf'
          ? 'Derivative text extracted from the PDF’s text layer; the original PDF is preserved unchanged and may read differently. '
          : 'Shown exactly as stored. '}
        Markdown and HTML are displayed as text, never rendered or run.
      </p>

      <MappingPanel doc={doc} />
    </article>
  );
}

function MetadataForm({
  doc,
  collections,
  onSaved,
}: {
  doc: ImportedDocument;
  collections: ResearchCollection[];
  onSaved: () => void;
}) {
  const api = useApi();
  const { error, busy, run } = useSubmit();
  const [collectionId, setCollectionId] = useState(String(doc.collectionId));
  const [title, setTitle] = useState(doc.title);
  const [author, setAuthor] = useState(doc.author ?? '');
  const [publisher, setPublisher] = useState(doc.publisher ?? '');
  const [publishedDate, setPublishedDate] = useState(doc.publishedDate ?? '');
  const [attribution, setAttribution] = useState(doc.attributionNote ?? '');
  const [rights, setRights] = useState(doc.rightsNote ?? '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const saved = await run(async () => {
      await api.updateResearchMetadata(doc.id, {
        collectionId: Number(collectionId),
        title,
        author: blankToNull(author),
        publisher: blankToNull(publisher),
        publishedDate: blankToNull(publishedDate),
        attributionNote: blankToNull(attribution),
        rightsNote: blankToNull(rights),
      });
    });
    if (saved) onSaved();
  }

  return (
    <form className="form-section" onSubmit={submit} aria-label="Edit details">
      <p className="muted">
        Only these details can change. The original file, its fingerprint and the extracted text are
        fixed.
      </p>
      <SelectField
        label="Collection"
        value={collectionId}
        onChange={setCollectionId}
        options={collections.map((c) => ({ value: String(c.id), label: c.name }))}
      />
      <TextField label="Title" value={title} maxLength={200} onChange={setTitle} />
      <TextField label="Author" value={author} onChange={setAuthor} />
      <TextField label="Publisher or source" value={publisher} onChange={setPublisher} />
      <TextField
        label="Date written or published"
        value={publishedDate}
        hint="YYYY, YYYY-MM or YYYY-MM-DD."
        onChange={setPublishedDate}
      />
      <TextAreaField label="Attribution note" value={attribution} onChange={setAttribution} />
      <TextAreaField label="Rights and redistribution note" value={rights} onChange={setRights} />
      <FormError message={error} />
      <button type="submit" className="button button-primary" disabled={busy}>
        Save details
      </button>
    </form>
  );
}
