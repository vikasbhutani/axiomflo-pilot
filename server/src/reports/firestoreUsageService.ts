/**
 * UsageService on Firestore:
 *   companies/{companyId}/usage/{requestId}        written by the gateway
 *   companies/{companyId}/exchangeRates/{YYYY-MM}  set by a Company Admin, audited
 *
 * Individual users' records are found by `principal.id` alone and then filtered by
 * time, so no composite index has to be created by hand. That reads all of a person's
 * records, which is fine at pilot volumes; past MAX_USAGE_RECORDS the result says
 * `truncated` (add a composite index on principal.id + timestamp then).
 */
import type { Auth } from 'firebase-admin/auth';
import { FieldValue, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { MAX_USAGE_RECORDS, type ExchangeRateView, type PersonView, type UsageService, type UsageView } from './service.js';

const PROVIDERS = new Set(['anthropic', 'gemini_vertex']);
const COST_STATUSES = new Set(['reconciled', 'estimated', 'unavailable']);
const tokens = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;

/** A stored record as a view, or null if it doesn't have the expected shape. */
export function usageView(id: string, d: DocumentData): UsageView | null {
  const principal = d.principal as { type?: unknown; id?: unknown } | undefined;
  if (!str(d.timestamp) || Number.isNaN(Date.parse(d.timestamp)) || principal?.type !== 'user' || !str(principal.id)) return null;
  if (!str(d.teamId) || !str(d.teamCode) || !PROVIDERS.has(d.providerId) || !str(d.modelId)) return null;
  if (d.requestStatus !== 'succeeded' && d.requestStatus !== 'failed') return null;
  if (!COST_STATUSES.has(d.costStatus)) return null;
  const cost = typeof d.estimatedCostUsd === 'number' && Number.isFinite(d.estimatedCostUsd) && d.estimatedCostUsd >= 0 ? d.estimatedCostUsd : null;
  const inputTokens = tokens(d.inputTokens);
  const outputTokens = tokens(d.outputTokens);
  // A cost always needs both token counts behind it; anything else is shown as unavailable.
  const costed = cost !== null && inputTokens !== null && outputTokens !== null && d.costStatus !== 'unavailable';
  return {
    id,
    timestamp: d.timestamp,
    principal: { type: 'user', id: principal.id },
    keyId: str(d.keyId) ? d.keyId : '',
    teamId: d.teamId,
    teamCode: d.teamCode,
    providerId: d.providerId,
    modelId: d.modelId,
    inputTokens,
    outputTokens,
    cacheWriteTokens: tokens(d.cacheWriteTokens),
    cacheReadTokens: tokens(d.cacheReadTokens),
    requestStatus: d.requestStatus,
    providerStatus: typeof d.providerStatus === 'number' ? d.providerStatus : null,
    costStatus: costed ? d.costStatus : 'unavailable',
    estimatedCostUsd: costed ? cost : null,
    priceVersion: costed && str(d.priceVersion) ? d.priceVersion : null,
    stream: d.stream === true,
    latencyMs: typeof d.latencyMs === 'number' ? d.latencyMs : null,
  };
}

function rateView(month: string, d: DocumentData): ExchangeRateView {
  return {
    month,
    rate: d.rate,
    currency: d.currency,
    setBy: typeof d.setBy === 'string' ? d.setBy : null,
    setAt: d.setAt instanceof Timestamp ? d.setAt.toDate().toISOString() : null,
  };
}

export function createFirestoreUsageService({ db, auth, logger }: { db: Firestore; auth: Auth; logger: Logger }): UsageService {
  const company = (c: string) => db.collection('companies').doc(c);

  async function namesFor(uids: string[]): Promise<Record<string, PersonView>> {
    const people: Record<string, PersonView> = {};
    for (let i = 0; i < uids.length; i += 100) {
      const { users } = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      for (const u of users) people[u.uid] = { name: u.displayName ?? null, email: u.email ?? null };
    }
    return people;
  }

  return {
    async listUsage(c, viewer, { startIso, endIso }) {
      const usage = company(c).collection('usage');
      const query =
        viewer.role === 'company_admin'
          ? usage.where('timestamp', '>=', startIso).where('timestamp', '<', endIso).orderBy('timestamp', 'desc').limit(MAX_USAGE_RECORDS + 1)
          : usage.where('principal.id', '==', viewer.uid).limit(MAX_USAGE_RECORDS + 1);
      const snap = await query.get();
      let skipped = 0;
      const records: UsageView[] = [];
      for (const doc of snap.docs) {
        const view = usageView(doc.id, doc.data());
        if (!view) {
          skipped++;
          continue;
        }
        // Belt and braces: the time window and the person are re-checked for every record.
        if (view.timestamp < startIso || view.timestamp >= endIso) continue;
        if (viewer.role !== 'company_admin' && view.principal.id !== viewer.uid) continue;
        records.push(view);
      }
      if (skipped > 0) logger.warn('usage records skipped', { companyId: c, skipped });
      records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const truncated = snap.size > MAX_USAGE_RECORDS;
      const shown = records.slice(0, MAX_USAGE_RECORDS);
      const people = await namesFor([...new Set(shown.map((r) => r.principal.id))]);
      return { records: shown, people, truncated, skipped };
    },

    async listRates(c) {
      const snap = await company(c).collection('exchangeRates').limit(600).get();
      return snap.docs
        .map((d) => rateView(d.id, d.data()))
        .filter((r) => typeof r.rate === 'number' && typeof r.currency === 'string')
        .sort((a, b) => a.month.localeCompare(b.month));
    },

    async setRate(c, actorUid, month, rate, currency) {
      const ref = company(c).collection('exchangeRates').doc(month);
      await db.runTransaction(async (tx) => {
        const [companySnap, memberSnap, existing] = await tx.getAll(company(c), company(c).collection('memberships').doc(actorUid), ref);
        if (!companySnap.exists || companySnap.get('status') !== 'active') throw new ApiError(403, 'forbidden', 'This AxiomFlo workspace isn’t active.');
        // Re-checked inside the transaction, so a just-demoted admin can't set rates.
        if (memberSnap.get('role') !== 'company_admin' || memberSnap.get('status') !== 'active') throw new ApiError(403, 'forbidden', 'Only Company Admins can set exchange rates.');
        tx.set(ref, { rate, currency, setBy: actorUid, setAt: FieldValue.serverTimestamp() });
        tx.create(company(c).collection('auditEvents').doc(), {
          actorUid,
          action: 'exchangeRate.set',
          targetType: 'exchangeRate',
          targetId: month,
          metadata: { rate, currency, previousRate: existing.exists ? (existing.get('rate') ?? null) : null },
          timestamp: FieldValue.serverTimestamp(),
        });
      });
      return rateView(month, (await ref.get()).data() ?? {});
    },
  };
}
