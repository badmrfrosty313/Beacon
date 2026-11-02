import { useState } from 'react';

import { Sidebar } from './components/Sidebar';
import { ArchiveView } from './modules/archive/ArchiveView';
import { LifelineView } from './modules/LifelineView';
import type { ModuleId } from './modules/registry';
import { SettingsView } from './modules/SettingsView';
import { WatchtowerView } from './modules/WatchtowerView';

function ModuleView({ id }: { id: ModuleId }) {
  switch (id) {
    case 'archive':
      return <ArchiveView />;
    case 'watchtower':
      return <WatchtowerView />;
    case 'lifeline':
      return <LifelineView />;
    case 'settings':
      return <SettingsView />;
  }
}

export default function App() {
  const [active, setActive] = useState<ModuleId>('archive');

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Sidebar active={active} onSelect={setActive} />
      <main id="main" className="content" tabIndex={-1}>
        <ModuleView id={active} />
      </main>
    </div>
  );
}
