/**
 * Calls the AxiomFlo API's admin endpoints. The API decides who may use them (an
 * active Company Admin, checked on every request); this file only shapes requests and
 * reads answers. It never sends a uid, company or inviter: the API takes those from the
 * sign-in token.
 */
import type { ApiClient } from '../auth/api';
import type { Role } from '../types';

export type MemberStatus = 'active' | 'suspended';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface MemberView {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  teamIds: string[];
  status: MemberStatus;
}

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  teamIds: string[];
  status: InvitationStatus;
  delivery: string;
  expiresAt: string;
  createdAt: string | null;
}

export interface NewInvitation {
  email: string;
  role: Role;
  teamIds: string[];
  expiresInDays: number;
}

export interface MemberChange {
  role?: Role;
  teamIds?: string[];
  status?: MemberStatus;
}

/** An answer from the API that isn't success, with its message safe to show. */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

const FALLBACK: Record<number, string> = {
  401: 'Your sign-in has expired. Please sign in again.',
  403: 'You don’t have permission to do that.',
  429: 'Too many changes in a short time. Please wait a minute and try again.',
};

export async function call<T>(api: ApiClient, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await api.fetch(path, { ...init, headers });
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: unknown };
  } | null;
  if (!response.ok) {
    // 4xx messages are written by the API for people to read; 5xx details are not shown.
    const message = response.status < 500 && typeof body?.error?.message === 'string' ? body.error.message : (FALLBACK[response.status] ?? 'We couldn’t complete that just now. Please try again.');
    throw new AdminApiError(response.status, message);
  }
  return body as T;
}

export function createAdminApi(api: ApiClient) {
  return {
    listMembers: async () => (await call<{ members: MemberView[] }>(api, '/api/members')).members,
    listInvitations: async () => (await call<{ invitations: InvitationView[] }>(api, '/api/invitations')).invitations,
    createInvitation: async (input: NewInvitation) =>
      (
        await call<{ invitation: InvitationView }>(api, '/api/invitations', {
          method: 'POST',
          body: JSON.stringify(input),
        })
      ).invitation,
    revokeInvitation: async (id: string) => (await call<{ invitation: InvitationView }>(api, `/api/invitations/${encodeURIComponent(id)}/revoke`, { method: 'POST' })).invitation,
    updateMember: async (uid: string, change: MemberChange) =>
      (await call<{ member: MemberView }>(api, `/api/members/${encodeURIComponent(uid)}`, { method: 'PATCH', body: JSON.stringify(change) })).member,
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;
