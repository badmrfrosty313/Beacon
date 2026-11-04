import { useReducer, useRef, useState } from 'react';

import { useApi } from './api/ApiContext';
import { errorMessage } from './api/errors';
import type { Note } from './api/types';
import { Sidebar } from './components/Sidebar';
import { ArchiveView, type ArchivePane, type ArchiveSection } from './modules/archive/ArchiveView';
import type { NoteDraft } from './modules/archive/NoteForm';
import { LifelineView } from './modules/LifelineView';
import type { ModuleId } from './modules/registry';
import type { NoteSeed } from './modules/scripture/referenceNote';
import { ScriptureView, type OpenRequest } from './modules/scripture/ScriptureView';
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
  | { type: 'prefill'; seed: NoteSeed }
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
    case 'prefill':
      // Starting a note from a Scripture reference must never overwrite or discard what the
      // user is already writing, nor interfere with a save in flight.
      if (state.savingRevision !== null || state.draft.title !== '' || state.draft.body !== '') {
        return state;
      }
      return {
        ...state,
        pane: { kind: 'new' },
        draft: { ...action.seed, revision: state.draft.revision + 1 },
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

export default function App({
  initialArchiveSection = 'documents',
}: {
  initialArchiveSection?: ArchiveSection;
}) {
  const api = useApi();
  const [archiveSection, setArchiveSection] = useState<ArchiveSection>(initialArchiveSection);
  const [active, setActive] = useState<ModuleId>('archive');
  const [archive, dispatch] = useReducer(archiveReducer, initialArchiveState);
  const [scriptureRequest, setScriptureRequest] = useState<OpenRequest | null>(null);
  const requestCounter = useRef(0);

  const noteDraftInProgress =
    archive.savingRevision !== null || archive.draft.title !== '' || archive.draft.body !== '';

  function selectModule(id: ModuleId) {
    // A reference opened from a note applies once; leaving Scripture must not re-open it later
    // over the user's own reading position.
    if (id !== 'scripture') setScriptureRequest(null);
    setActive(id);
  }

  function openScripture(reference: string) {
    requestCounter.current += 1;
    setScriptureRequest({ reference, nonce: requestCounter.current });
    setActive('scripture');
  }

  function createNoteFromReference(seed: NoteSeed) {
    dispatch({ type: 'prefill', seed });
    setArchiveSection('notes');
    setActive('archive');
  }

  function openUnsavedDraft() {
    dispatch({ type: 'select', pane: { kind: 'new' } });
    setArchiveSection('notes');
    setActive('archive');
  }

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
      <Sidebar active={active} onSelect={selectModule} />
      <main id="main" className="content" tabIndex={-1}>
        {import.meta.env.MODE === 'browser-demo' ? (
          <div role="status" className="browser-demo-notice">
            <strong>BROWSER DEMO</strong> · Browser-only IndexedDB. Not the Tauri/SQLite app. Do not
            enter sensitive notes. Data stays in this browser and may be cleared by browser
            settings.
          </div>
        ) : null}
        {active === 'archive' ? (
          <ArchiveView
            section={archiveSection}
            onSectionChange={setArchiveSection}
            pane={archive.pane}
            onPaneChange={(pane) => dispatch({ type: 'select', pane })}
            draft={archive.draft}
            onDraftChange={(draft) => dispatch({ type: 'edit', draft })}
            onDiscardDraft={() => dispatch({ type: 'discard' })}
            onSave={handleSave}
            saving={archive.savingRevision !== null}
            saveError={archive.saveError}
            refreshRevision={archive.refreshRevision}
            onOpenScripture={openScripture}
          />
        ) : null}
        {active === 'scripture' ? (
          <ScriptureView
            openRequest={scriptureRequest}
            onCreateNote={createNoteFromReference}
            noteDraftInProgress={noteDraftInProgress}
            onOpenDraft={openUnsavedDraft}
          />
        ) : null}
        {active === 'watchtower' ? <WatchtowerView /> : null}
        {active === 'lifeline' ? <LifelineView /> : null}
        {active === 'settings' ? <SettingsView /> : null}
      </main>
    </div>
  );
}
