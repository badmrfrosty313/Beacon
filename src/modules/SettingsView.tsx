import { useEffect, useState } from 'react';

import { useApi } from '../api/ApiContext';
import { errorMessage } from '../api/errors';
import type { AppInfo } from '../api/types';

type InfoState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; info: AppInfo };

export function SettingsView() {
  const api = useApi();
  const [state, setState] = useState<InfoState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api.getAppInfo().then(
      (info) => {
        if (!cancelled) setState({ status: 'ready', info });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <section className="view" aria-labelledby="settings-title">
      <header className="view-header">
        <div>
          <h1 id="settings-title">Settings</h1>
          <p className="view-subtitle">About this installation and where your data lives.</p>
        </div>
      </header>

      {state.status === 'loading' ? (
        <p className="muted" role="status">
          Loading…
        </p>
      ) : null}

      {state.status === 'error' ? (
        <div className="banner banner-error" role="alert">
          <p>{state.message}</p>
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          {state.info.databaseError ? (
            <div className="banner banner-error" role="alert">
              <p>BEACON could not open its local database: {state.info.databaseError}</p>
            </div>
          ) : null}
          <dl className="info-grid">
            <dt>Version</dt>
            <dd>{state.info.appVersion}</dd>
            <dt>Database schema</dt>
            <dd>
              {state.info.schemaVersion === null
                ? 'Unavailable'
                : `Version ${state.info.schemaVersion}`}
            </dd>
            <dt>Data location</dt>
            <dd className="mono">{state.info.dataDir}</dd>
          </dl>
        </>
      ) : null}

      <h2 className="section-heading">Privacy and storage</h2>
      <ul className="plain-list">
        <li>BEACON needs no account and sends nothing over the network.</li>
        <li>There is no telemetry and there are no cloud or AI features in this version.</li>
        <li>
          Notes are stored in a local SQLite database. They are <strong>not encrypted</strong> in
          this version, so anyone with access to this computer account can read them.
        </li>
        <li>There is no backup or export yet. Keep your own copies of anything important.</li>
      </ul>
    </section>
  );
}
