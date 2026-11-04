import { useEffect, useState } from 'react';

import { useApi } from '../../api/ApiContext';
import { errorMessage } from '../../api/errors';
import type { NoteSummary } from '../../api/types';
import { NoteDetail } from './NoteDetail';
import { NoteForm, type NoteDraft } from './NoteForm';
import { DocumentsPanel } from './DocumentsPanel';
import { NoteList } from './NoteList';

export type ArchiveSection = 'documents' | 'notes';

export type ArchivePane = { kind: 'empty' } | { kind: 'new' } | { kind: 'note'; id: number };

interface ArchiveViewProps {
  section: ArchiveSection;
  onSectionChange: (section: ArchiveSection) => void;
  pane: ArchivePane;
  onPaneChange: (pane: ArchivePane) => void;
  draft: NoteDraft;
  onDraftChange: (draft: NoteDraft) => void;
  onDiscardDraft: () => void;
  onSave: (draft: NoteDraft) => void;
  saving: boolean;
  saveError: string | null;
  refreshRevision: number;
  /** Opens a Scripture reference found in a note; omit to hide those links. */
  onOpenScripture?: (reference: string) => void;
}

export function ArchiveView({
  section,
  onSectionChange,
  pane,
  onPaneChange,
  draft,
  onDraftChange,
  onDiscardDraft,
  onSave,
  saving,
  saveError,
  refreshRevision,
  onOpenScripture,
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
          <p className="view-subtitle">
            Documents and notes kept in local storage, available with no network.
          </p>
        </div>
      </header>

      <div className="section-switch" role="group" aria-label="Archive sections">
        {(['documents', 'notes'] as const).map((id) => (
          <button
            key={id}
            type="button"
            className="button"
            aria-pressed={section === id}
            onClick={() => onSectionChange(id)}
          >
            {id === 'documents' ? 'Documents' : 'Notes'}
          </button>
        ))}
      </div>

      {section === 'documents' ? (
        <DocumentsPanel />
      ) : (
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
            {pane.kind === 'note' ? (
              <NoteDetail key={pane.id} id={pane.id} onOpenScripture={onOpenScripture} />
            ) : null}
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
      )}
    </section>
  );
}
