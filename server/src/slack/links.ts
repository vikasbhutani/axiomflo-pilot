/**
 * Links between Slack accounts and AxiomFlo members.
 *
 *   companies/{companyId}/slackLinkCodes/{sha256(code)}   one-time codes, 15 minutes
 *   companies/{companyId}/slackLinks/{teamId}_{userId}     Slack user -> AxiomFlo uid
 *
 * How a link is made:
 * 1. Someone messages the bot. Slack has proved who they are (the request signature).
 * 2. The bot sends them, privately, a one-time link to AxiomFlo carrying a code.
 * 3. They sign in to AxiomFlo and confirm. The API links the two accounts only if the
 *    member is active AND their verified sign-in email matches the email on the Slack
 *    profile. So a forwarded link can't connect someone else's AxiomFlo account to the
 *    wrong Slack user.
 *
 * Only a hash of each code is stored. Codes work once.
 */
import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, type DocumentData, type Firestore, type Transaction } from 'firebase-admin/firestore';
import type { Role } from '../membership/records.js';

export const CODE_TTL_MS = 15 * 60_000;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const LINK_ID = /^[A-Z0-9]{1,20}_[A-Z0-9]{1,20}$/;

export interface SlackIdentity {
  teamId: string;
  userId: string;
}

export interface SlackLinkView {
  id: string;
  uid: string;
  slackTeamId: string;
  slackUserId: string;
  slackName: string | null;
  linkedAt: string | null;
}

export interface PendingLink {
  slackTeamId: string;
  slackUserId: string;
  slackName: string | null;
  slackEmail: string | null;
}

export class LinkRejectedError extends Error {
  constructor(
    readonly reason: 'invalid' | 'expired' | 'email_mismatch' | 'no_slack_email' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'LinkRejectedError';
  }
}

export interface SlackLinkService {
  /** A fresh one-time code for a Slack user (bot side). */
  createCode(companyId: string, pending: PendingLink): Promise<string>;
  /** Who a code is for, without using it up (shown on the confirm page). */
  peekCode(companyId: string, code: string): Promise<PendingLink>;
  /** Uses a code to link the Slack user to `uid`, if the emails match. */
  redeemCode(companyId: string, code: string, member: { uid: string; email: string | null; emailVerified: boolean }): Promise<SlackLinkView>;
  /** The AxiomFlo uid linked to a Slack user, or null. */
  findUid(companyId: string, slack: SlackIdentity): Promise<string | null>;
  listLinks(companyId: string, actor: { uid: string; role: Role }): Promise<SlackLinkView[]>;
  deleteLink(companyId: string, actor: { uid: string; role: Role }, linkId: string): Promise<void>;
}

export const linkId = (s: SlackIdentity) => `${s.teamId}_${s.userId}`;
export const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
export const newCode = () => randomBytes(32).toString('base64url');
export const sameEmail = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const invalid = () => new LinkRejectedError('invalid', 'This Slack link isn’t valid. Message the AxiomFlo bot in Slack to get a new one.');
const expired = () => new LinkRejectedError('expired', 'This Slack link has expired. Message the AxiomFlo bot in Slack to get a new one.');

export function createFirestoreSlackLinkService({ db, now = () => Date.now() }: { db: Firestore; now?: () => number }): SlackLinkService {
  const company = (c: string) => db.collection('companies').doc(c);
  const codeRef = (c: string, code: string) => company(c).collection('slackLinkCodes').doc(hashCode(code));
  const view = (id: string, d: DocumentData): SlackLinkView => ({
    id,
    uid: d.uid,
    slackTeamId: d.slackTeamId,
    slackUserId: d.slackUserId,
    slackName: typeof d.slackName === 'string' ? d.slackName : null,
    linkedAt: d.linkedAt?.toDate ? d.linkedAt.toDate().toISOString() : null,
  });

  async function readCode(c: string, code: string, tx?: Transaction) {
    if (!CODE.test(code)) throw invalid();
    const ref = codeRef(c, code);
    const snap = tx ? await tx.get(ref) : await ref.get();
    if (!snap.exists) throw invalid();
    const d = snap.data()!;
    if (typeof d.expiresAt !== 'number' || d.expiresAt < now()) throw expired();
    return { ref, pending: { slackTeamId: d.slackTeamId, slackUserId: d.slackUserId, slackName: d.slackName ?? null, slackEmail: d.slackEmail ?? null } as PendingLink };
  }

  return {
    async createCode(c, pending) {
      const code = newCode();
      await codeRef(c, code).set({ ...pending, expiresAt: now() + CODE_TTL_MS, createdAt: FieldValue.serverTimestamp() });
      return code;
    },

    async peekCode(c, code) {
      return (await readCode(c, code)).pending;
    },

    async redeemCode(c, code, member) {
      const id = await db.runTransaction(async (tx) => {
        const { ref, pending } = await readCode(c, code, tx);
        if (!pending.slackEmail) throw new LinkRejectedError('no_slack_email', 'Your Slack profile has no email address, so it can’t be matched to your AxiomFlo account. Ask your Slack admin to add one.');
        if (!member.emailVerified || !sameEmail(pending.slackEmail, member.email)) {
          throw new LinkRejectedError('email_mismatch', 'Your Slack email doesn’t match the email you signed in to AxiomFlo with, so the accounts weren’t linked. Sign in with the same email you use in Slack.');
        }
        const linkRef = company(c).collection('slackLinks').doc(linkId({ teamId: pending.slackTeamId, userId: pending.slackUserId }));
        tx.delete(ref);
        tx.set(linkRef, { uid: member.uid, slackTeamId: pending.slackTeamId, slackUserId: pending.slackUserId, slackName: pending.slackName, linkedAt: FieldValue.serverTimestamp() });
        tx.create(company(c).collection('auditEvents').doc(), {
          actorUid: member.uid,
          action: 'slackLink.create',
          targetType: 'slackLink',
          targetId: linkRef.id,
          metadata: {},
          timestamp: FieldValue.serverTimestamp(),
        });
        return linkRef.id;
      });
      const snap = await company(c).collection('slackLinks').doc(id).get();
      return view(id, snap.data() ?? {});
    },

    async findUid(c, slack) {
      const snap = await company(c).collection('slackLinks').doc(linkId(slack)).get();
      const uid = snap.exists ? snap.get('uid') : null;
      return typeof uid === 'string' && uid ? uid : null;
    },

    async listLinks(c, actor) {
      const links = company(c).collection('slackLinks');
      const snap = await (actor.role === 'company_admin' ? links.limit(500) : links.where('uid', '==', actor.uid).limit(50)).get();
      return snap.docs.map((d) => view(d.id, d.data())).filter((l) => actor.role === 'company_admin' || l.uid === actor.uid);
    },

    async deleteLink(c, actor, id) {
      if (!LINK_ID.test(id)) throw new LinkRejectedError('not_found', 'That Slack link doesn’t exist.');
      const ref = company(c).collection('slackLinks').doc(id);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || (actor.role !== 'company_admin' && snap.get('uid') !== actor.uid)) throw new LinkRejectedError('not_found', 'That Slack link doesn’t exist.');
        tx.delete(ref);
        tx.create(company(c).collection('auditEvents').doc(), {
          actorUid: actor.uid,
          action: 'slackLink.delete',
          targetType: 'slackLink',
          targetId: id,
          metadata: { linkedUid: snap.get('uid') },
          timestamp: FieldValue.serverTimestamp(),
        });
      });
    },
  };
}
