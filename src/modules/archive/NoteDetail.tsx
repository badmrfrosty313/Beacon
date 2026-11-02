import { useEffect, useState } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import type { Note } from '../../api/types';
import { formatTimestamp } from '../../lib/format';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; note: Note };

/**
 * Shows one note. Render with `key={id}` so state resets when the selection changes.
 * The body is untrusted user text: it is only ever rendered as a text node, never as HTML.
 */
export function NoteDetail({ id }: { id: number }) {
  const api = useApi();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api.getNote(id).then(
      (note) => {
        if (!cancelled) setState({ status: 'ready', note });
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
        Loading note…
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

  const { note } = state;
  return (
    <article className="note" aria-labelledby="note-heading">
      <header className="note-header">
        <h2 id="note-heading">{note.title}</h2>
        <p className="note-meta">
          Saved <time dateTime={note.createdAt}>{formatTimestamp(note.createdAt)}</time>
        </p>
      </header>
      {note.body.length > 0 ? (
        <div className="note-body">{note.body}</div>
      ) : (
        <p className="muted">This note has no body.</p>
      )}
    </article>
  );
}
