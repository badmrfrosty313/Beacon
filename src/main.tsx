import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ApiProvider } from './api/ApiContext';
import { createBrowserDemoApi } from './api/browserDemoApi';
import { createTauriApi } from './api/tauriApi';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

const api = import.meta.env.MODE === 'browser-demo' ? createBrowserDemoApi() : createTauriApi();

if (import.meta.env.MODE === 'browser-demo') {
  // Fetch the packaged Scripture chunk (same origin) as soon as the page loads, so reading
  // keeps working even if the network drops before the Scripture tab is first opened.
  void api.getScriptureOverview().catch(() => undefined);
}

createRoot(container).render(
  <StrictMode>
    <ApiProvider api={api}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
