/**
 * A sample "usage snapshot" in the exact shape the AxiomFlo API hands the agent for one
 * question about real data (see docs/agent/usage-snapshot.md), plus the totals this web
 * app's real pages calculate for it.
 *
 * The records are invented but realistic: they go through the same `buildDataset` and
 * `summarize` code as the real Overview, Teams and Showback pages, so a Python test can
 * prove the agent's figures match those pages. They are also shaped so that each savings
 * suggestion has something to find.
 *
 * Regenerate with `npm run agent:fixtures`.
 */
import { summarize, type CostSummary } from './calculations';
import { buildDataset, modelDisplayName, type RealRecord } from '../reports/realData';
import type { ExchangeRateView, UsageResponse, UsageView } from '../reports/reportsApi';
import { buildUpgradeSnapshot } from '../../server/src/upgrade/realWorkspace';

export const SNAPSHOT_VERSION = 1;

const company = { id: 'pilot', name: 'Pilot company (sample snapshot)', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' };

const teams = [
  { id: 'team-platform', name: 'Platform Engineering', code: 'ENG-PLATFORM' },
  { id: 'team-product', name: 'Product Experience', code: 'ENG-PRODUCT' },
];

const people: Record<string, { name: string | null; email: string | null }> = {
  'uid-ava': { name: 'Ava Admin', email: 'ava@example.com' },
  'uid-ben': { name: 'Ben Builder', email: 'ben@example.com' },
  'uid-chloe': { name: 'Chloe Chen', email: 'chloe@example.com' },
  'uid-dev': { name: null, email: 'dev@example.com' },
};

const memberships = [
  { uid: 'uid-ava', role: 'company_admin', teamIds: ['team-platform'] },
  { uid: 'uid-ben', role: 'individual_user', teamIds: ['team-platform'] },
  { uid: 'uid-chloe', role: 'individual_user', teamIds: ['team-product'] },
  { uid: 'uid-dev', role: 'individual_user', teamIds: ['team-product'] },
] as const;

// [start, end) of each Australia/Sydney month in UTC, as the API's monthBoundsUtc gives them.
const MONTHS: [string, string, string][] = [
  ['2026-08', '2026-07-31T14:00:00.000Z', '2026-08-31T14:00:00.000Z'],
  ['2026-09', '2026-08-31T14:00:00.000Z', '2026-09-30T14:00:00.000Z'],
  ['2026-10', '2026-09-30T14:00:00.000Z', '2026-10-31T13:00:00.000Z'],
];

// October deliberately has no rate of its own, so it falls back to September's.
const exchangeRates: ExchangeRateView[] = [
  { month: '2026-08', rate: 1.52, currency: 'AUD', setBy: 'uid-ava', setAt: '2026-08-02T00:00:00.000Z' },
  { month: '2026-09', rate: 1.51, currency: 'AUD', setBy: 'uid-ava', setAt: '2026-09-02T00:00:00.000Z' },
];

// USD per million tokens: input, output, cache write, cache read (sample values).
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 5, 0.2],
  'claude-sonnet-5-5': [2, 10, 2.5, 0.1],
  'claude-haiku-5-5': [0.1, 0.5, 0.125, 0.01],
  'gemini-3.1-pro': [2, 12, 0, 0.2],
  'gemini-3.5-flash': [1.5, 9, 0, 0.15],
};

/** Small deterministic random number generator (mulberry32), so the file never changes by itself. */
function random(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pattern {
  uid: string;
  teamId: string;
  model: string;
  /** Requests per month, by month index. */
  perMonth: [number, number, number];
  input: [number, number];
  output: [number, number];
  cache?: 'none' | 'reads';
}

const PATTERNS: Pattern[] = [
  // Opus for short jobs: the "costly model for small jobs" suggestion.
  { uid: 'uid-ben', teamId: 'team-platform', model: 'claude-opus-5-5', perMonth: [60, 64, 70], input: [6000, 20000], output: [40, 260], cache: 'reads' },
  { uid: 'uid-ben', teamId: 'team-platform', model: 'claude-opus-5-5', perMonth: [20, 20, 22], input: [10000, 30000], output: [900, 2500], cache: 'reads' },
  // Long prompts sent without caching: the "prompt caching" suggestion.
  { uid: 'uid-ava', teamId: 'team-platform', model: 'claude-sonnet-5-5', perMonth: [40, 44, 48], input: [20000, 60000], output: [300, 900], cache: 'none' },
  { uid: 'uid-ava', teamId: 'team-platform', model: 'claude-haiku-5-5', perMonth: [50, 50, 50], input: [2000, 8000], output: [50, 400], cache: 'reads' },
  // Product Experience's October jump, mostly Chloe on Gemini 3.1 Pro.
  { uid: 'uid-chloe', teamId: 'team-product', model: 'gemini-3.1-pro', perMonth: [16, 18, 80], input: [10000, 40000], output: [1000, 4000] },
  { uid: 'uid-dev', teamId: 'team-product', model: 'gemini-3.5-flash', perMonth: [60, 60, 64], input: [3000, 15000], output: [200, 1200] },
];

function between(rand: () => number, [lo, hi]: [number, number]): number {
  return Math.round(lo + rand() * (hi - lo));
}

function costUsd(model: string, input: number, output: number, cacheWrite: number, cacheRead: number): number {
  const [i, o, w, r] = PRICES[model];
  return (input * i + output * o + cacheWrite * w + cacheRead * r) / 1_000_000;
}

function buildMonthRecords(monthIndex: number): UsageView[] {
  const [month, startIso] = MONTHS[monthIndex];
  const rand = random(20261019 + monthIndex);
  const start = Date.parse(startIso);
  const records: UsageView[] = [];
  let n = 0;
  for (const p of PATTERNS) {
    for (let i = 0; i < p.perMonth[monthIndex]; i++) {
      n++;
      // Days 1 to 27 of the month, so no record sits near a month boundary.
      const timestamp = new Date(start + Math.floor((1 + rand() * 26) * 86_400_000)).toISOString();
      const provider = p.model.startsWith('claude') ? 'anthropic' : 'gemini_vertex';
      const roll = rand();
      const failed = roll < 0.08;
      // About 4% of requests got no usage back from the provider, so they have no cost.
      const unresolved = !failed && roll > 0.96;
      const input = between(rand, p.input);
      const output = failed ? 0 : between(rand, p.output);
      const isClaude = provider === 'anthropic';
      const cacheRead = isClaude && p.cache === 'reads' ? between(rand, [4000, 16000]) : 0;
      const cacheWrite = isClaude && p.cache === 'reads' && rand() < 0.2 ? between(rand, [500, 2000]) : 0;
      records.push({
        id: `req_${month.replace('-', '')}_${String(n).padStart(4, '0')}`,
        timestamp,
        principal: { type: 'user', id: p.uid },
        keyId: `key_${p.uid.slice(4)}`,
        teamId: p.teamId,
        teamCode: teams.find((t) => t.id === p.teamId)!.code,
        providerId: provider,
        modelId: p.model,
        inputTokens: unresolved ? null : input,
        outputTokens: unresolved ? null : output,
        cacheWriteTokens: unresolved || !isClaude ? null : cacheWrite,
        cacheReadTokens: unresolved ? null : isClaude ? cacheRead : 0,
        requestStatus: failed ? 'failed' : 'succeeded',
        providerStatus: failed ? 529 : 200,
        costStatus: unresolved ? 'unavailable' : 'estimated',
        estimatedCostUsd: unresolved ? null : costUsd(p.model, input, output, cacheWrite, cacheRead),
        priceVersion: unresolved ? null : 'sample-2026-10',
        stream: rand() < 0.5,
        latencyMs: between(rand, [300, 9000]),
      });
    }
  }
  // The API returns newest first.
  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function usageFor(monthIndex: number, viewerUid: string | null): UsageResponse {
  const [month, startIso, endIso] = MONTHS[monthIndex];
  const all = buildMonthRecords(monthIndex);
  const records = viewerUid ? all.filter((r) => r.principal.id === viewerUid) : all;
  const uids = new Set(records.map((r) => r.principal.id));
  return { month, startIso, endIso, records, people: Object.fromEntries(Object.entries(people).filter(([uid]) => uids.has(uid))), truncated: false, skipped: 0 };
}

/**
 * The snapshot the API would send for a question from `viewerUid`. Admins get everyone's
 * records; Individual Users only their own and only their assigned teams, as the API's
 * own report routes decide.
 */
export function buildUsageSnapshot(viewerUid = 'uid-ava') {
  const m = memberships.find((x) => x.uid === viewerUid)!;
  const isAdmin = m.role === 'company_admin';
  const visibleTeams = isAdmin ? teams : teams.filter((t) => (m.teamIds as readonly string[]).includes(t.id));
  const usage = MONTHS.map((_, i) => usageFor(i, isAdmin ? null : viewerUid));
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    label: 'SAMPLE SNAPSHOT: invented records in the shape the AxiomFlo API sends the agent. Not real usage.',
    generatedAt: '2026-10-19T03:30:00.000Z',
    company,
    viewer: { uid: m.uid, role: m.role, teamIds: [...m.teamIds], status: 'active', ...people[m.uid] },
    teams: visibleTeams,
    currentMonth: MONTHS[MONTHS.length - 1][0],
    usage,
    exchangeRates,
    // Built by the API's own code (server/src/upgrade/realWorkspace.ts), as the real snapshot is.
    upgrade: buildUpgradeSnapshot({
      usage: usage as Parameters<typeof buildUpgradeSnapshot>[0]['usage'],
      rates: exchangeRates,
      reportingCurrency: company.reportingCurrency,
      timeZone: company.reportingTimezone,
      today: '2026-10-19',
      from: `${MONTHS[0][0]}-01`,
      teams: visibleTeams,
      role: m.role,
      companyName: company.name,
    }),
  };
}

type GoldenRow = { scope: string; period: string; summary: CostSummary };

/** Totals the real pages show for the sample snapshot, by month and scope. */
export function buildSnapshotGoldenTotals() {
  const snapshot = buildUsageSnapshot();
  const rows: GoldenRow[] = [];
  const add = (scope: string, period: string, records: RealRecord[]) => rows.push({ scope, period, summary: summarize(records) });
  const modelIds = new Set<string>();
  for (const usage of snapshot.usage) {
    const { records } = buildDataset(usage, snapshot.exchangeRates, company.reportingCurrency, teams);
    const period = usage.month;
    add('company', period, records);
    for (const t of teams) add(`team:${t.id}`, period, records.filter((r) => r.teamId === t.id));
    for (const p of ['anthropic', 'gemini_vertex']) add(`provider:${p}`, period, records.filter((r) => r.providerId === p));
    for (const r of records) modelIds.add(r.modelId);
    for (const id of [...modelIds].sort()) add(`model:${id}`, period, records.filter((r) => r.modelId === id));
    for (const m of memberships) add(`viewer:${m.uid}`, period, records.filter((r) => r.principal.id === m.uid));
  }
  // Model names, including shapes the sample doesn't use, so both sides name models the same way.
  const nameSamples = [...modelIds, 'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-sonnet-5', 'gemini-2.5-flash-lite', 'gemini-4-argon', 'some-other-model'];
  return {
    snapshotVersion: SNAPSHOT_VERSION,
    label: 'SAMPLE SNAPSHOT: totals calculated by src/reports/realData.ts and src/lib/calculations.ts.',
    currency: company.reportingCurrency,
    periods: MONTHS.map(([m]) => m),
    modelNames: Object.fromEntries(nameSamples.sort().map((id) => [id, modelDisplayName(id)])),
    rows,
  };
}
