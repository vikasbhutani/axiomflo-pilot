/**
 * AdminService on Firestore. The Admin SDK bypasses security rules, so every rule
 * below is enforced here, inside transactions:
 *
 * - At most one pending invitation per email: a lock document keyed by a hash of the
 *   normalized email (`invitationEmails/{sha256}`) points at the pending invitation,
 *   so two admins inviting the same person at once can't both succeed.
 * - Accepting uses the VERIFIED token email only; role and teams come only from the
 *   invitation. Membership creation and consuming the invitation happen together.
 * - A suspended member can't get back in through an invitation.
 * - The company always keeps at least one active Company Admin.
 * - Every change writes an audit event in the same transaction.
 */
import { createHash } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { VerifiedIdentity } from '../auth/tokenVerifier.js';
import { ApiError } from '../http/errors.js';
import { parseMembership, parseTeam, type MembershipRecord, type Role } from '../membership/records.js';
import type { AcceptResult, AdminService, InvitationStatus, InvitationView, MemberView } from './service.js';
import { checkRoleTeams, normalizeEmail, type MemberPatch } from './validation.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const conflict = (message: string) => new ApiError(409, 'conflict', message);
const forbidden = (message: string) => new ApiError(403, 'forbidden', message);
const notFound = (message: string) => new ApiError(404, 'not_found', message);

export function emailKey(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail).digest('hex');
}

function isoOrNull(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function invitationView(id: string, data: DocumentData, now: number): InvitationView {
  const expiresAt = data.expiresAt as Timestamp;
  let status = data.status as InvitationStatus;
  if (status === 'pending' && expiresAt.toMillis() <= now) status = 'expired';
  return {
    id,
    email: data.normalizedEmail,
    role: data.role,
    teamIds: data.teamIds ?? [],
    status,
    delivery: 'Created — email not sent',
    expiresAt: expiresAt.toDate().toISOString(),
    createdAt: isoOrNull(data.createdAt),
  };
}

export function createFirestoreAdminService({ db, auth, now = () => Date.now() }: { db: Firestore; auth: Auth; now?: () => number }): AdminService {
  const company = (c: string) => db.collection('companies').doc(c);
  const memberships = (c: string) => company(c).collection('memberships');
  const invitations = (c: string) => company(c).collection('invitations');
  const audit = (tx: Transaction, c: string, event: { actorUid: string; action: string; targetType: string; targetId: string; metadata: Record<string, unknown> }) =>
    tx.create(company(c).collection('auditEvents').doc(), { ...event, timestamp: FieldValue.serverTimestamp() });

  /** Every team ID must exist in this company and be active. */
  async function checkTeams(tx: Transaction, c: string, teamIds: string[]): Promise<void> {
    if (teamIds.length === 0) return;
    const snaps = await tx.getAll(...teamIds.map((id) => company(c).collection('teams').doc(id)));
    for (const snap of snaps) {
      if (!snap.exists || parseTeam(c, snap.id, snap.data() ?? {}).status !== 'active') {
        throw new ApiError(400, 'bad_request', `Team "${snap.id}" isn't an active team in this company.`);
      }
    }
  }

  async function requireActiveCompany(tx: Transaction, c: string): Promise<void> {
    const snap = await tx.get(company(c));
    if (!snap.exists || snap.get('status') !== 'active') throw forbidden('This AxiomFlo workspace isn’t active.');
  }

  async function memberViews(records: MembershipRecord[]): Promise<MemberView[]> {
    const profiles = new Map<string, { email: string | null; displayName: string | null }>();
    for (let i = 0; i < records.length; i += 100) {
      const { users } = await auth.getUsers(records.slice(i, i + 100).map((r) => ({ uid: r.uid })));
      for (const u of users) profiles.set(u.uid, { email: u.email ?? null, displayName: u.displayName ?? null });
    }
    return records.map((r) => ({ uid: r.uid, email: profiles.get(r.uid)?.email ?? null, displayName: profiles.get(r.uid)?.displayName ?? null, role: r.role, teamIds: r.teamIds, status: r.status }));
  }

  return {
    async listMembers(c) {
      const snap = await memberships(c).limit(500).get();
      const records = snap.docs.map((d) => parseMembership(c, d.id, d.data()));
      const views = await memberViews(records);
      return views.sort((a, b) => (a.email ?? a.uid).localeCompare(b.email ?? b.uid));
    },

    async listInvitations(c) {
      const snap = await invitations(c).orderBy('createdAt', 'desc').limit(200).get();
      const t = now();
      return snap.docs.map((d) => invitationView(d.id, d.data(), t));
    },

    async createInvitation(c, actorUid, input) {
      // Someone who is already a member doesn't need an invitation (and a suspended one mustn't get one).
      const existingUser = await auth.getUserByEmail(input.normalizedEmail).catch((e: { code?: string }) => {
        if (e.code === 'auth/user-not-found') return null;
        throw e;
      });

      const ref = invitations(c).doc();
      const lockRef = company(c).collection('invitationEmails').doc(emailKey(input.normalizedEmail));
      await db.runTransaction(async (tx) => {
        await requireActiveCompany(tx, c);
        const lock = await tx.get(lockRef);
        if (lock.exists) {
          const current = await tx.get(invitations(c).doc(lock.get('invitationId')));
          if (current.exists && current.get('status') === 'pending' && (current.get('expiresAt') as Timestamp).toMillis() > now()) {
            throw conflict('There is already a pending invitation for this email. Revoke it first to send a new one.');
          }
        }
        if (existingUser) {
          const member = await tx.get(memberships(c).doc(existingUser.uid));
          if (member.exists) throw conflict('This person is already a member. Change their role or teams instead.');
        }
        await checkTeams(tx, c, input.teamIds);

        const expiresAt = Timestamp.fromMillis(now() + input.expiresInDays * DAY_MS);
        tx.create(ref, {
          normalizedEmail: input.normalizedEmail,
          role: input.role,
          teamIds: input.teamIds,
          status: 'pending',
          deliveryStatus: 'not_sent',
          expiresAt,
          invitedBy: actorUid,
          acceptedByUid: null,
          createdAt: FieldValue.serverTimestamp(),
          acceptedAt: null,
        });
        tx.set(lockRef, { invitationId: ref.id });
        // The audit trail records the invitation ID, not the email address.
        audit(tx, c, { actorUid, action: 'invitation.created', targetType: 'invitation', targetId: ref.id, metadata: { role: input.role, teamIds: input.teamIds, expiresInDays: input.expiresInDays } });
      });
      const created = await ref.get();
      return invitationView(ref.id, created.data() ?? {}, now());
    },

    async revokeInvitation(c, actorUid, invitationId) {
      const ref = invitations(c).doc(invitationId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('Invitation not found.');
        if (snap.get('status') !== 'pending') throw conflict(`This invitation is already ${snap.get('status')}.`);
        const lockRef = company(c).collection('invitationEmails').doc(emailKey(snap.get('normalizedEmail')));
        const lock = await tx.get(lockRef);
        tx.update(ref, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: actorUid });
        if (lock.exists && lock.get('invitationId') === invitationId) tx.delete(lockRef);
        audit(tx, c, { actorUid, action: 'invitation.revoked', targetType: 'invitation', targetId: invitationId, metadata: {} });
      });
      return invitationView(invitationId, (await ref.get()).data() ?? {}, now());
    },

    async acceptInvitation(c, identity: VerifiedIdentity): Promise<AcceptResult> {
      if (!identity.emailVerified || !identity.email) throw forbidden('Verify your email address before accepting an invitation.');
      const email = normalizeEmail(identity.email);
      const lockRef = company(c).collection('invitationEmails').doc(emailKey(email));
      const memberRef = memberships(c).doc(identity.uid);

      return db.runTransaction(async (tx) => {
        await requireActiveCompany(tx, c);
        const [member, lock] = await tx.getAll(memberRef, lockRef);
        if (member.exists) {
          const record = parseMembership(c, identity.uid, member.data() ?? {});
          // A suspended member stays suspended; an invitation can't undo that.
          if (record.status !== 'active') throw forbidden('Your AxiomFlo access is suspended.');
          // A retry after success (or an existing member) changes nothing.
          return { result: 'already_member', role: record.role, teamIds: record.teamIds };
        }
        if (!lock.exists) throw notFound('No invitation matches your email address.');

        const invRef = invitations(c).doc(lock.get('invitationId'));
        const inv = await tx.get(invRef);
        const data = inv.data();
        if (!inv.exists || !data || data.status !== 'pending' || data.normalizedEmail !== email) throw notFound('No invitation matches your email address.');
        if ((data.expiresAt as Timestamp).toMillis() <= now()) throw notFound('Your invitation has expired. Ask your administrator for a new one.');

        const role = data.role as Role;
        const teamIds = (data.teamIds ?? []) as string[];
        checkRoleTeams(role, teamIds);
        await checkTeams(tx, c, teamIds);

        tx.create(memberRef, { uid: identity.uid, role, teamIds, status: 'active', invitationId: invRef.id, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        tx.update(invRef, { status: 'accepted', acceptedByUid: identity.uid, acceptedAt: FieldValue.serverTimestamp() });
        tx.delete(lockRef);
        audit(tx, c, { actorUid: identity.uid, action: 'invitation.accepted', targetType: 'membership', targetId: identity.uid, metadata: { invitationId: invRef.id, role, teamIds } });
        return { result: 'accepted', role, teamIds };
      });
    },

    async updateMember(c, actorUid, targetUid, patch: MemberPatch) {
      if (actorUid === targetUid) throw forbidden('You can’t change your own role, teams or status. Ask another Company Admin.');
      const ref = memberships(c).doc(targetUid);

      await db.runTransaction(async (tx) => {
        await requireActiveCompany(tx, c);
        const snap = await tx.get(ref);
        if (!snap.exists) throw notFound('Member not found.');
        const before = parseMembership(c, targetUid, snap.data() ?? {});
        const after = {
          role: patch.role ?? before.role,
          status: patch.status ?? before.status,
          // Becoming an admin clears team assignments (admins see every team).
          teamIds: patch.teamIds ?? ((patch.role ?? before.role) === 'company_admin' ? [] : before.teamIds),
        };
        checkRoleTeams(after.role, after.teamIds);
        await checkTeams(tx, c, after.teamIds);

        const wasActiveAdmin = before.role === 'company_admin' && before.status === 'active';
        const staysActiveAdmin = after.role === 'company_admin' && after.status === 'active';
        if (wasActiveAdmin && !staysActiveAdmin) {
          // Reading the active admins inside the transaction makes two concurrent demotions conflict.
          const admins = await tx.get(memberships(c).where('role', '==', 'company_admin').where('status', '==', 'active'));
          if (admins.docs.filter((d) => d.id !== targetUid).length === 0) {
            throw conflict('The company needs at least one active Company Admin.');
          }
        }

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (after.role !== before.role) changes.role = { from: before.role, to: after.role };
        if (after.status !== before.status) changes.status = { from: before.status, to: after.status };
        if (after.teamIds.join() !== before.teamIds.join()) changes.teamIds = { from: before.teamIds, to: after.teamIds };
        if (Object.keys(changes).length === 0) return;

        tx.update(ref, { ...after, updatedAt: FieldValue.serverTimestamp() });
        audit(tx, c, { actorUid, action: 'member.updated', targetType: 'membership', targetId: targetUid, metadata: { changes } });
      });

      const record = parseMembership(c, targetUid, (await ref.get()).data() ?? {});
      return (await memberViews([record]))[0];
    },
  };
}

