/**
 * Builds the usage snapshot sent to the AxiomFlo Agent with a question
 * (docs/agent/usage-snapshot.md).
 *
 * It holds exactly what the verified member would see on the real report pages for those
 * months, read with the same UsageService and the same scoping (admins: everyone's
 * requests; individual users: only their own). The agent never reads the database.
 */
import type { VerifiedIdentity } from '../auth/tokenVerifier.js';
import type { ActiveMember } from '../membership/requireMember.js';
import { localDate, monthBoundsUtc } from '../reports/months.js';
import type { ExchangeRateView, UsageResult, UsageService } from '../reports/service.js';
import { buildUpgradeSnapshot, type UpgradeSnapshot } from '../upgrade/realWorkspace.js';

export const SNAPSHOT_VERSION = 1;
/** Most months one snapshot holds; the agent refuses more. */
export const MAX_SNAPSHOT_MONTHS = 6;

export interface UsageSnapshot {
  snapshotVersion: typeof SNAPSHOT_VERSION;
  generatedAt: string;
  company: { id: string; name: string; reportingCurrency: string; reportingTimezone: string };
  viewer: { uid: string; role: string; teamIds: string[]; status: 'active'; name: string | null; email: string | null };
  teams: { id: string; name: string; code: string }[];
  currentMonth: string;
  usage: ({ month: string; startIso: string; endIso: string } & UsageResult)[];
  exchangeRates: ExchangeRateView[];
  /** Upgrade Analysis inputs over the same records (docs/agent/upgrade-analysis.md). */
  upgrade: UpgradeSnapshot;
}

export async function buildSnapshot({
  member,
  identity,
  usage,
  companyId,
  months,
  currentMonth,
  now = new Date(),
}: {
  member: ActiveMember;
  identity: Pick<VerifiedIdentity, 'displayName' | 'email'>;
  usage: UsageService;
  companyId: string;
  months: string[];
  currentMonth: string;
  now?: Date;
}): Promise<UsageSnapshot> {
  if (months.length === 0 || months.length > MAX_SNAPSHOT_MONTHS) throw new Error(`A snapshot holds 1 to ${MAX_SNAPSHOT_MONTHS} months.`);
  const { company, membership, teams } = member;
  const viewer = { uid: membership.uid, role: membership.role };
  const [rates, ...perMonth] = await Promise.all([
    usage.listRates(companyId),
    ...months.map(async (month) => {
      const [startIso, endIso] = monthBoundsUtc(month, company.reportingTimezone);
      return { month, startIso, endIso, ...(await usage.listUsage(companyId, viewer, { startIso, endIso })) };
    }),
  ]);
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    company: { id: companyId, name: company.name, reportingCurrency: company.reportingCurrency, reportingTimezone: company.reportingTimezone },
    viewer: { uid: membership.uid, role: membership.role, teamIds: [...membership.teamIds], status: 'active', name: identity.displayName ?? null, email: identity.email ?? null },
    teams: teams.map((t) => ({ id: t.id, name: t.name, code: t.code })),
    currentMonth,
    usage: perMonth,
    exchangeRates: rates,
    upgrade: buildUpgradeSnapshot({
      usage: perMonth,
      rates,
      reportingCurrency: company.reportingCurrency,
      timeZone: company.reportingTimezone,
      today: localDate(now, company.reportingTimezone),
      from: `${[...months].sort()[0]}-01`,
      teams,
      role: membership.role,
      companyName: company.name,
    }),
  };
}
