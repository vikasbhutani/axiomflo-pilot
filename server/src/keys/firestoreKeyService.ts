/**
 * KeyService on Firestore, under companies/{companyId}/apiKeys/{keyId}.
 *
 * - A key is always tied to one team the owner belongs to (any team for an admin),
 *   so usage is attributed to that team.
 * - Using a key re-checks the owner's membership: suspending someone, or moving them
 *   off the key's team, stops their keys on the next request.
 * - Creating and revoking are audited; the secret and its hash never appear in audits.
 */
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { ApiError } from '../http/errors.js';
import { parseMembership, parseTeam } from '../membership/records.js';
import { generateKey, hashSecret, parseKey, secretMatches } from './keyFormat.js';
import { KeyRejectedError, MAX_ACTIVE_KEYS_PER_USER, type KeyService, type KeyView } from './service.js';

const forbidden = (message: string) => new ApiError(403, 'forbidden', message);
const notFound = (message: string) => new ApiError(404, 'not_found', message);
const conflict = (message: string) => new ApiError(409, 'conflict', message);

function isoOrNull(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function keyView(id: string, data: DocumentData, ownerEmail: string | null = null): KeyView {
  return {
    id,
    name: data.name,
    ownerUid: data.uid,
    ownerEmail,
    teamId: data.teamId,
    status: data.status,
    hint: data.hint,
    createdAt: isoOrNull(data.createdAt),
    revokedAt: isoOrNull(data.revokedAt),
  };
}

export function createFirestoreKeyService({ db, auth }: { db: Firestore; auth: Auth }): KeyService {
  const company = (c: string) => db.collection('companies').doc(c);
  const keys = (c: string) => company(c).collection('apiKeys');
  const audit = (tx: Transaction, c: string, event: { actorUid: string; action: string; targetId: string; metadata: Record<string, unknown> }) =>
    tx.create(company(c).collection('auditEvents').doc(), { ...event, targetType: 'apiKey', timestamp: FieldValue.serverTimestamp() });

  return {
    async listKeys(c, actor) {
      const query = actor.role === 'company_admin' ? keys(c) : keys(c).where('uid', '==', actor.uid);
      const snap = await query.limit(500).get();
      const docs = snap.docs.sort((a, b) => (b.get('createdAt')?.toMillis?.() ?? 0) - (a.get('createdAt')?.toMillis?.() ?? 0));
      if (actor.role !== 'company_admin') return docs.map((d) => keyView(d.id, d.data()));
      const uids = [...new Set(docs.map((d) => d.get('uid') as string))];
      const emails = new Map<string, string | null>();
      for (let i = 0; i < uids.length; i += 100) {
        const { users } = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
        for (const u of users) emails.set(u.uid, u.email ?? null);
      }
      return docs.map((d) => keyView(d.id, d.data(), emails.get(d.get('uid')) ?? null));
    },

    async createKey(c, actor, input) {
      const { id, secret, full } = generateKey();
      const ref = keys(c).doc(id);
      await db.runTransaction(async (tx) => {
        const [companySnap, memberSnap, teamSnap] = await tx.getAll(company(c), company(c).collection('memberships').doc(actor.uid), company(c).collection('teams').doc(input.teamId));
        if (!companySnap.exists || companySnap.get('status') !== 'active') throw forbidden('This AxiomFlo workspace isn’t active.');
        if (!memberSnap.exists) throw forbidden('You don’t have access to this AxiomFlo workspace.');
        const member = parseMembership(c, actor.uid, memberSnap.data() ?? {});
        if (member.status !== 'active') throw forbidden('Your AxiomFlo access is suspended.');
        if (!teamSnap.exists || parseTeam(c, teamSnap.id, teamSnap.data() ?? {}).status !== 'active') throw new ApiError(400, 'bad_request', 'That team doesn’t exist.');
        if (member.role !== 'company_admin' && !member.teamIds.includes(input.teamId)) throw forbidden('You can only create keys for your own teams.');
        const active = await tx.get(keys(c).where('uid', '==', actor.uid).where('status', '==', 'active'));
        if (active.size >= MAX_ACTIVE_KEYS_PER_USER) throw conflict(`You already have ${MAX_ACTIVE_KEYS_PER_USER} active keys. Revoke one first.`);
        tx.create(ref, {
          uid: actor.uid,
          name: input.name,
          teamId: input.teamId,
          hash: hashSecret(secret),
          hint: secret.slice(-4),
          status: 'active',
          createdBy: actor.uid,
          createdAt: FieldValue.serverTimestamp(),
          revokedAt: null,
          revokedBy: null,
        });
        audit(tx, c, { actorUid: actor.uid, action: 'apiKey.created', targetId: id, metadata: { ownerUid: actor.uid, teamId: input.teamId } });
      });
      return { key: keyView(id, (await ref.get()).data() ?? {}), secret: full };
    },

    async revokeKey(c, actor, keyId) {
      const ref = keys(c).doc(keyId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        // Someone else's key looks the same as a missing one to an individual user.
        if (!snap.exists || (actor.role !== 'company_admin' && snap.get('uid') !== actor.uid)) throw notFound('Key not found.');
        if (snap.get('status') === 'revoked') return;
        tx.update(ref, { status: 'revoked', revokedAt: FieldValue.serverTimestamp(), revokedBy: actor.uid });
        audit(tx, c, { actorUid: actor.uid, action: 'apiKey.revoked', targetId: keyId, metadata: { ownerUid: snap.get('uid') } });
      });
      return keyView(keyId, (await ref.get()).data() ?? {});
    },

    async resolveKey(c, rawKey) {
      const parsed = parseKey(rawKey);
      if (!parsed) throw new KeyRejectedError('malformed');
      const snap = await keys(c).doc(parsed.id).get();
      if (!snap.exists) throw new KeyRejectedError('unknown');
      if (!secretMatches(parsed.secret, snap.get('hash'))) throw new KeyRejectedError('mismatch');
      if (snap.get('status') !== 'active') throw new KeyRejectedError('revoked');

      const uid = snap.get('uid') as string;
      const teamId = snap.get('teamId') as string;
      const [companySnap, memberSnap, teamSnap] = await db.getAll(company(c), company(c).collection('memberships').doc(uid), company(c).collection('teams').doc(teamId));
      if (!companySnap.exists || companySnap.get('status') !== 'active') throw new KeyRejectedError('company_inactive');
      if (!memberSnap.exists) throw new KeyRejectedError('no_membership');
      const member = parseMembership(c, uid, memberSnap.data() ?? {});
      if (member.status !== 'active') throw new KeyRejectedError('member_suspended');
      const team = teamSnap.exists ? parseTeam(c, teamId, teamSnap.data() ?? {}) : null;
      if (!team || team.status !== 'active') throw new KeyRejectedError('team_inactive');
      if (member.role !== 'company_admin' && !member.teamIds.includes(teamId)) throw new KeyRejectedError('team_not_assigned');
      return { keyId: parsed.id, uid, role: member.role, teamId, teamCode: team.code };
    },
  };
}
