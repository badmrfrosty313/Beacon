import { useEffect, useState } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import type { Document } from '../../api/types';
import { formatBytes, formatTimestamp } from '../../lib/format';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; document: Document };

const FORMAT_LABELS: Record<string, string> = {
  md: 'Markdown (.md)',
  txt: 'Plain text (.txt)',
};

/**
 * Reads one imported document. Render with `key={id}` so state resets on selection change.
 *
 * The text is untrusted: it is shown only as a text node inside a `white-space: pre-wrap`
 * element, so line breaks are preserved and no HTML, script or Markdown is ever interpreted.
 * The native backend re-verifies the stored original's SHA-256 before returning it.
 */
export function DocumentReader({ id }: { id: number }) {
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api.getDocument(id).then(
      (document) => {
        if (!cancelled) setState({ status: 'ready', document });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, id]);

  if (state.status === 'loading') {
    return (
      <p className="muted pad" role="status">
        Loading document…
      </p>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="banner banner-error" role="alert">
        <p>{state.message}</p>
      </div>
    );
  }

  const { document: doc } = state;
  return (
    <article className="note" aria-labelledby="document-heading">
      <header className="note-header">
        <h2 id="document-heading">{doc.title}</h2>
        <dl className="doc-meta">
          <div>
            <dt>File name</dt>
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
            <dt>Imported</dt>
            <dd>
              <time dateTime={doc.importedAt}>{formatTimestamp(doc.importedAt)}</time>
            </dd>
          </div>
          <div>
            <dt>SHA-256 fingerprint</dt>
            <dd>
              <code className="doc-hash">{doc.sha256}</code>
            </dd>
          </div>
        </dl>
      </header>
      <div className="doc-body" role="region" aria-label="Document text" tabIndex={0}>
        {doc.body}
      </div>
      <p className="muted doc-footnote">
        Shown exactly as stored: line breaks are kept, and Markdown and HTML are displayed as text,
        never rendered or run.
      </p>
    </article>
  );
}
