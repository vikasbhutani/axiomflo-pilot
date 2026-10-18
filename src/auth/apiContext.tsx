/**
 * Makes the signed-in API client available to screens that call the AxiomFlo API
 * directly (the admin screen). It is null when Firebase isn't configured.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { ApiClient } from './api';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ api, children }: { api: ApiClient | null; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApiClient(): ApiClient | null {
  return useContext(ApiContext);
}
