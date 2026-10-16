/** Builds the real sign-in pieces from the build-time environment. */
import { createApiClient } from './api';
import { readAppSettings, readFirebaseConfig } from './config';
import { getFirebaseApp } from './firebaseApp';
import { createFirebaseAuthClient } from './firebaseClient';
import { createFirestoreMembershipService, createHttpMembershipService, noBackendMembershipService, type MembershipService } from './membershipService';
import type { AuthClient } from './types';

export function createAuthSetup(): { client: AuthClient | null; missingConfig: string[]; membershipService: MembershipService } {
  const { config, missing } = readFirebaseConfig();
  if (!config) return { client: null, missingConfig: missing, membershipService: noBackendMembershipService };

  const app = getFirebaseApp(config);
  const client = createFirebaseAuthClient(app);
  const { apiBaseUrl } = readAppSettings();
  // Memberships come from Firestore (protected by firestore.rules), or from a custom
  // backend API when VITE_API_BASE_URL is set.
  const membershipService = apiBaseUrl
    ? createHttpMembershipService(createApiClient({ baseUrl: apiBaseUrl, getIdToken: () => client.getIdToken() }))
    : createFirestoreMembershipService(app);
  return { client, missingConfig: [], membershipService };
}
