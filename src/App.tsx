import { useState } from 'react';

import { Sidebar } from './components/Sidebar';
import { ArchiveView, type ArchivePane } from './modules/archive/ArchiveView';
import type { NoteDraft } from './modules/archive/NoteForm';
import { LifelineView } from './modules/LifelineView';
import type { ModuleId } from './modules/registry';
import { SettingsView } from './modules/SettingsView';
import { WatchtowerView } from './modules/WatchtowerView';

export default function App() {
  const [active, setActive] = useState<ModuleId>('archive');
  // Keep the unsaved draft and selected Archive pane across module navigation.
  const [archivePane, setArchivePane] = useState<ArchivePane>({ kind: 'empty' });
  const [noteDraft, setNoteDraft] = useState<NoteDraft>({ title: '', body: '' });

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar active={active} onSelect={setActive} />
      <main id="main" className="content" tabIndex={-1}>
        {active === 'archive' ? (
          <ArchiveView
            pane={archivePane}
            onPaneChange={setArchivePane}
            draft={noteDraft}
            onDraftChange={setNoteDraft}
            onDiscardDraft={() => setNoteDraft({ title: '', body: '' })}
          />
        ) : null}
        {active === 'watchtower' ? <WatchtowerView /> : null}
        {active === 'lifeline' ? <LifelineView /> : null}
        {active === 'settings' ? <SettingsView /> : null}
      </main>
    </div>
  );
}
