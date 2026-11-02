import type { NoteSummary } from '../../api/types';
import { formatTimestamp } from '../../lib/format';

interface NoteListProps {
  /** null while the first load is in flight */
  notes: NoteSummary[] | null;
  error: string | null;
  selectedId: number | null;
  creating: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
  onRetry: () => void;
}

export function NoteList({
  notes,
  error,
  selectedId,
  creating,
  onSelect,
  onNew,
  onRetry,
}: NoteListProps) {
  return (
    <div className="note-list-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          Notes
          {notes ? <span className="count">{notes.length}</span> : null}
        </h2>
        <button type="button" className="button button-primary" onClick={onNew} disabled={creating}>
          New note
        </button>
      </div>

      {error ? (
        <div className="banner banner-error" role="alert">
          <p>{error}</p>
          <button type="button" className="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : null}

      {!error && notes === null ? (
        <p className="muted pad" role="status">
          Loading notes…
        </p>
      ) : null}

      {notes !== null && notes.length === 0 && !error ? (
        <p className="muted pad">No notes yet.</p>
      ) : null}

      {notes !== null && notes.length > 0 ? (
        <ul className="note-list" aria-label="Notes">
          {notes.map((note) => (
            <li key={note.id}>
              <button
                type="button"
                className={note.id === selectedId ? 'note-item note-item-active' : 'note-item'}
                aria-current={note.id === selectedId ? 'true' : undefined}
                onClick={() => onSelect(note.id)}
              >
                <span className="note-item-title">{note.title}</span>
                <span className="note-item-date">{formatTimestamp(note.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
