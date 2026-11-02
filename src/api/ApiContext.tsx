import { createContext, useContext, type ReactNode } from 'react';

import type { BeaconApi } from './beaconApi';

const ApiContext = createContext<BeaconApi | null>(null);

export function ApiProvider({ api, children }: { api: BeaconApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): BeaconApi {
  const api = useContext(ApiContext);
  if (api === null) {
    throw new Error('useApi must be used inside <ApiProvider>');
  }
  return api;
}
