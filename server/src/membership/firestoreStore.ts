/**
 * MembershipStore backed by Cloud Firestore through the Admin SDK.
 *
 * The Admin SDK bypasses Firestore security rules, so this code is the access
 * control: every path is built from the configured company ID and the verified UID,
 * never from request input.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { parseCompany, parseMembership, parseTeam } from './records.js';
import type { MembershipStore } from './store.js';

export function createFirestoreMembershipStore(db: Firestore): MembershipStore {
  const company = (companyId: string) => db.collection('companies').doc(companyId);
  return {
    async getCompany(companyId) {
      const snap = await company(companyId).get();
      return snap.exists ? parseCompany(companyId, snap.data() ?? {}) : null;
    },
    async getMembership(companyId, uid) {
      const snap = await company(companyId).collection('memberships').doc(uid).get();
      return snap.exists ? parseMembership(companyId, uid, snap.data() ?? {}) : null;
    },
    async listTeams(companyId) {
      // The pilot has two teams; the limit guards against an accidental huge read.
      const snap = await company(companyId).collection('teams').limit(100).get();
      return snap.docs.map((d) => parseTeam(companyId, d.id, d.data())).sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
