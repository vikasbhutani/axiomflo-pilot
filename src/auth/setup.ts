/** Builds the real sign-in pieces from the build-time environment. */
import { createApiClient } from './api';
import { readAppSettings, readFirebaseConfig } from './config';
import { createFirebaseAuthClient } from './firebaseClient';
import { createHttpMembershipService, noBackendMembershipService, type MembershipService } from './membershipService';
import type { AuthClient } from './types';

export function createAuthSetup(): { client: AuthClient | null; missingConfig: string[]; membershipService: MembershipService } {
  const { config, missing } = readFirebaseConfig();
  const client = config ? createFirebaseAuthClient(config) : null;
  const { apiBaseUrl } = readAppSettings();
  // Without a backend, nobody gets an approved membership: everyone sees "Access pending".
  const membershipService =
    client && apiBaseUrl ? createHttpMembershipService(createApiClient({ baseUrl: apiBaseUrl, getIdToken: () => client.getIdToken() })) : noBackendMembershipService;
  return { client, missingConfig: missing, membershipService };
}
