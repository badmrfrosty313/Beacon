import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ApiProvider } from './api/ApiContext';
import { createTauriApi } from './api/tauriApi';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <ApiProvider api={createTauriApi()}>
      <App />
    </ApiProvider>
  </StrictMode>,
);
