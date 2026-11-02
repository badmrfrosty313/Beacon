import { useEffect, useState } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import type { NoteSummary } from '../../api/types';
import { NoteDetail } from './NoteDetail';
import { NoteForm, type NoteDraft } from './NoteForm';
import { NoteList } from './NoteList';

export type ArchivePane = { kind: 'empty' } | { kind: 'new' } | { kind: 'note'; id: number };

interface ArchiveViewProps {
  pane: ArchivePane;
  onPaneChange: (pane: ArchivePane) => void;
  draft: NoteDraft;
  onDraftChange: (draft: NoteDraft) => void;
  onDiscardDraft: () => void;
  onSave: (draft: NoteDraft) => void;
  saving: boolean;
  saveError: string | null;
  refreshRevision: number;
}

export function ArchiveView({
  pane,
  onPaneChange,
  draft,
  onDraftChange,
  onDiscardDraft,
  onSave,
  saving,
  saveError,
  refreshRevision,
}: ArchiveViewProps) {
  const api = useApi();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.listNotes().then(
      (list) => {
        if (!cancelled) setNotes(list);
      },
      (error: unknown) => {
        if (!cancelled) setListError(errorMessage(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, reloadToken, refreshRevision]);

  function reload() {
    setListError(null);
    setReloadToken((token) => token + 1);
  }

  function handleCancel() {
    onDiscardDraft();
    onPaneChange({ kind: 'empty' });
  }

  return (
    <section className="view" aria-labelledby="archive-title">
      <header className="view-header">
        <div>
          <h1 id="archive-title">Archive</h1>
          <p className="view-subtitle">Notes stored on this device, available with no network.</p>
        </div>
        <span className="pill pill-demo">Sprint 001 demo</span>
      </header>

      <p className="callout">
        Plain-text notes are a first working record type. Importing documents and searching them are
        not implemented yet.
      </p>

      <div className="archive-layout">
        <NoteList
          notes={notes}
          error={listError}
          selectedId={pane.kind === 'note' ? pane.id : null}
          creating={pane.kind === 'new'}
          onSelect={(id) => onPaneChange({ kind: 'note', id })}
          onNew={() => onPaneChange({ kind: 'new' })}
          onRetry={reload}
        />

        <div className="archive-pane">
          {pane.kind === 'new' ? (
            <NoteForm
              draft={draft}
              onDraftChange={onDraftChange}
              onSave={onSave}
              saving={saving}
              saveError={saveError}
              onCancel={handleCancel}
            />
          ) : null}
          {pane.kind === 'note' ? <NoteDetail key={pane.id} id={pane.id} /> : null}
          {pane.kind === 'empty' ? (
            <div className="empty-state">
              <h2>{notes && notes.length > 0 ? 'Select a note' : 'Start with a note'}</h2>
              <p className="muted">
                {notes && notes.length > 0
                  ? 'Choose a note from the list, or create a new one.'
                  : 'Create your first note. It is saved on this computer and is still here after you close and reopen BEACON.'}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
