import { useReducer, useState } from 'react';

import { useApi } from './api/ApiContext';
import { errorMessage } from './api/errors';
import type { Note } from './api/types';
import { Sidebar } from './components/Sidebar';
import { ArchiveView, type ArchivePane } from './modules/archive/ArchiveView';
import type { NoteDraft } from './modules/archive/NoteForm';
import { LifelineView } from './modules/LifelineView';
import type { ModuleId } from './modules/registry';
import { SettingsView } from './modules/SettingsView';
import { WatchtowerView } from './modules/WatchtowerView';

interface ArchiveState {
  pane: ArchivePane;
  draft: NoteDraft;
  savingRevision: number | null;
  saveError: string | null;
  refreshRevision: number;
}

type ArchiveAction =
  | { type: 'select'; pane: ArchivePane }
  | { type: 'edit'; draft: NoteDraft }
  | { type: 'discard' }
  | { type: 'save-start'; revision: number }
  | { type: 'save-success'; revision: number; note: Note }
  | { type: 'save-failure'; revision: number; error: string };

const initialArchiveState: ArchiveState = {
  pane: { kind: 'empty' },
  draft: { title: '', body: '', revision: 0 },
  savingRevision: null,
  saveError: null,
  refreshRevision: 0,
};

function archiveReducer(state: ArchiveState, action: ArchiveAction): ArchiveState {
  switch (action.type) {
    case 'select':
      return { ...state, pane: action.pane };
    case 'edit':
      // A pending save owns its draft until completion, even when the form remounts.
      if (state.savingRevision !== null || action.draft.revision !== state.draft.revision) {
        return state;
      }
      return {
        ...state,
        draft: { ...action.draft, revision: state.draft.revision + 1 },
        saveError: null,
      };
    case 'discard':
      if (state.savingRevision !== null) return state;
      return {
        ...state,
        draft: { title: '', body: '', revision: state.draft.revision + 1 },
        saveError: null,
      };
    case 'save-start':
      if (state.savingRevision !== null || state.draft.revision !== action.revision) {
        return state;
      }
      return { ...state, savingRevision: action.revision, saveError: null };
    case 'save-success':
      if (state.savingRevision !== action.revision) return state;
      return {
        ...state,
        savingRevision: null,
        saveError: null,
        refreshRevision: state.refreshRevision + 1,
        draft: { title: '', body: '', revision: state.draft.revision + 1 },
        // Do not hijack navigation if the user selected another note while saving.
        pane: state.pane.kind === 'new' ? { kind: 'note', id: action.note.id } : state.pane,
      };
    case 'save-failure':
      if (state.savingRevision !== action.revision) return state;
      return { ...state, savingRevision: null, saveError: action.error };
  }
}

export default function App() {
  const api = useApi();
  const [active, setActive] = useState<ModuleId>('archive');
  const [archive, dispatch] = useReducer(archiveReducer, initialArchiveState);

  async function handleSave(draft: NoteDraft) {
    if (archive.savingRevision !== null || draft.revision !== archive.draft.revision) return;

    dispatch({ type: 'save-start', revision: draft.revision });
    try {
      const note = await api.createNote({ title: draft.title, body: draft.body });
      dispatch({ type: 'save-success', revision: draft.revision, note });
    } catch (error) {
      dispatch({ type: 'save-failure', revision: draft.revision, error: errorMessage(error) });
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar active={active} onSelect={setActive} />
      <main id="main" className="content" tabIndex={-1}>
        {active === 'archive' ? (
          <ArchiveView
            pane={archive.pane}
            onPaneChange={(pane) => dispatch({ type: 'select', pane })}
            draft={archive.draft}
            onDraftChange={(draft) => dispatch({ type: 'edit', draft })}
            onDiscardDraft={() => dispatch({ type: 'discard' })}
            onSave={handleSave}
            saving={archive.savingRevision !== null}
            saveError={archive.saveError}
            refreshRevision={archive.refreshRevision}
          />
        ) : null}
        {active === 'watchtower' ? <WatchtowerView /> : null}
        {active === 'lifeline' ? <LifelineView /> : null}
        {active === 'settings' ? <SettingsView /> : null}
      </main>
    </div>
  );
}
