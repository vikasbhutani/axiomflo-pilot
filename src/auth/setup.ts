/** Builds the real sign-in pieces from the build-time environment. */
import { createApiClient, type ApiClient } from './api';
import { readAppSettings, readFirebaseConfig } from './config';
import { getFirebaseApp } from './firebaseApp';
import { createFirebaseAuthClient } from './firebaseClient';
import { createHttpMembershipService, noBackendMembershipService, type MembershipService } from './membershipService';
import type { AuthClient } from './types';

export function createAuthSetup(): { client: AuthClient | null; missingConfig: string[]; membershipService: MembershipService; api: ApiClient | null } {
  const { config, missing } = readFirebaseConfig();
  if (!config) return { client: null, missingConfig: missing, membershipService: noBackendMembershipService, api: null };

  const app = getFirebaseApp(config);
  const client = createFirebaseAuthClient(app);
  // Memberships come from the AxiomFlo API. By default it is on the same address as
  // the web app (the web server forwards /api to it); VITE_API_BASE_URL overrides that.
  const baseUrl = readAppSettings().apiBaseUrl ?? window.location.origin;
  const api = createApiClient({ baseUrl, getIdToken: (forceRefresh) => client.getIdToken(forceRefresh) });
  return { client, missingConfig: [], membershipService: createHttpMembershipService(api), api };
}
