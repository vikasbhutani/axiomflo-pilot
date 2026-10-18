/**
 * Admin operations: members and invitations. Every operation is scoped to one
 * company (the configured pilot company) and enforces its own invariants inside a
 * Firestore transaction, so the rules hold even if two admins act at once.
 */
import type { VerifiedIdentity } from '../auth/tokenVerifier.js';
import type { MemberStatus, Role } from '../membership/records.js';
import type { InvitationInput, MemberPatch } from './validation.js';

export interface MemberView {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  teamIds: string[];
  status: MemberStatus;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InvitationView {
  id: string;
  email: string;
  role: Role;
  teamIds: string[];
  /** "expired" is a pending invitation past its expiry date. */
  status: InvitationStatus;
  /** There's no email delivery in the pilot; the admin shares the sign-in link themselves. */
  delivery: 'Created — email not sent';
  expiresAt: string;
  createdAt: string | null;
}

export type AcceptResult = { result: 'accepted' | 'already_member'; role: Role; teamIds: string[] };

export interface AdminService {
  listMembers(companyId: string): Promise<MemberView[]>;
  listInvitations(companyId: string): Promise<InvitationView[]>;
  createInvitation(companyId: string, actorUid: string, input: InvitationInput): Promise<InvitationView>;
  revokeInvitation(companyId: string, actorUid: string, invitationId: string): Promise<InvitationView>;
  acceptInvitation(companyId: string, identity: VerifiedIdentity): Promise<AcceptResult>;
  updateMember(companyId: string, actorUid: string, targetUid: string, patch: MemberPatch): Promise<MemberView>;
}
