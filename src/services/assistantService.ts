/**
 * DEMO COST ASSISTANT — deterministic, read-only, no live AI model.
 *
 * Questions are matched to a small set of supported intents with keyword
 * rules. Every number is calculated from the same role-scoped records and
 * shared calculations as the rest of the app. The assistant never changes
 * data, never guesses a business reason for a cost change, and says plainly
 * when a question is outside its scope.
 */
import { pricingVersions, providers, models } from '../data/mockData';
import { currentTeams } from '../data/demoStore';
import { safeRatio, summarize, summarizeBy, type CostSummary } from '../lib/calculations';
import { formatCurrency, formatNumber, formatPercent, formatPeriod, formatPeriodRange, periodBounds } from '../lib/format';
import { can } from '../lib/permissions';
import type { CostedUsageRecord, CostStatus, PeriodKey, ProviderId, UserContext } from '../types';
import { getCurrentUser, getReportingPeriods, selectRecords } from './mockService';
import { buildDemoScorecard } from './finopsService';
import type { Scorecard } from '../lib/finops';

export type AssistantIntent = 'optimise' | 'unit_economics' | 'team_spend' | 'provider_spend' | 'period_change' | 'supporting_requests' | 'estimated_meaning' | 'unresolved' | 'read_only' | 'unsupported';

/** Usage Explorer filters for the "View supporting requests" action. */
export interface SupportingFilters {
  from: string;
  to: string;
  team?: string;
  provider?: ProviderId;
  cost?: CostStatus;
}

export interface AssistantTable {
  caption: string;
  columns: { key: string; label: string; align?: 'left' | 'right' }[];
  rows: Record<string, string>[];
  footer?: Record<string, string>;
}

export interface AssistantResponse {
  intent: AssistantIntent;
  /** Short plain-language answer, one paragraph per entry. */
  answer: string[];
  /** Dates, currency and cost status the answer is based on. */
  facts: { label: string; value: string }[];
  table?: AssistantTable;
  supporting?: { label: string; filters: SupportingFilters };
  /** A page in the app that shows the answer in full. */
  page?: { label: string; to: string };
  /** Raw figures behind the answer (used by tests and for transparency). */
  figures: Record<string, number | null>;
  followUps: string[];
}

export const SUGGESTED_QUESTIONS = [
  'What did each team spend this month?',
  'How much did we spend on Gemini?',
  'Why did estimated spend increase compared with the previous period?',
  'Show the requests behind this total.',
  'What does estimated cost mean?',
  'How can we cut our AI costs?',
  'What does each workflow cost in tokens?',
];

export interface AssistantContext {
  /** Selected reporting period in the top bar. */
  period: PeriodKey;
  /** Filters behind the previous answer, so "this total" has a meaning. */
  previous?: SupportingFilters;
}

const SCOPE_TEXT =
  'I can answer questions about estimated spend by team or provider, how this period compares with the previous one, the requests behind a total, requests with unavailable costs, what estimated cost means, ways to cut cost, and unit economics and token cost per workflow.';

function normalise(question: string): string {
  return question.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}

const has = (text: string, ...words: (string | RegExp)[]) => words.some((w) => (typeof w === 'string' ? text.includes(w) : w.test(text)));

export function detectIntent(question: string): AssistantIntent {
  const q = normalise(question);
  if (q === '') return 'unsupported';
  // Anything asking the assistant to change something is refused first.
  if (has(q, /\b(change|set|update|raise|lower|increase|reduce|edit|delete|remove|disable|enable|turn off|turn on|connect|disconnect|rename|invite|suspend|approve|pay|charge)\b.*\b(budget|setting|connection|provider|team|user|limit|key|credential|invoice|payment)s?\b/) && !has(q, /\bwhy\b/, 'compared', 'previous', 'last month')) return 'read_only';
  if (has(q, /\bmean(s|ing)?\b/, 'what is estimated', 'what is an estimate', 'define', 'explain estimated', 'how is the cost calculated', 'how are costs calculated', 'how is cost calculated')) return 'estimated_meaning';
  if (has(q, /\boptimi[sz]/, /\bsav(e|es|ing|ings)\b/, /\b(cut|reduce|lower|trim)\b.*\b(cost|costs|spend|spending|bill)\b/, 'lever', 'scorecard', 'finops', 'cost down', 'efficien')) return 'optimise';
  if (has(q, 'unit economic', 'unit cost', 'workflow', 'per request', 'cost per', 'token cost', 'per token', 'per million')) return 'unit_economics';
  if (has(q, /\bwhy\b/, 'compare', 'compared', 'previous', 'last month', 'prior', 'month over month', 'change in', 'trend', 'went up', 'go up', 'went down', 'increase', 'decrease')) return 'period_change';
  if (has(q, 'unresolved', 'unavailable', 'missing cost', 'missing usage', 'no cost')) return 'unresolved';
  if (has(q, 'request', 'behind', 'underlying', 'breakdown of this', 'drill')) return 'supporting_requests';
  if (has(q, 'gemini', 'vertex', 'anthropic', 'claude', 'provider')) return 'provider_spend';
  if (has(q, 'team', 'department', 'spend', 'spent', 'cost', 'total')) return 'team_spend';
  return 'unsupported';
}

function previousPeriod(period: PeriodKey): PeriodKey | null {
  const periods = [...getReportingPeriods()].sort();
  const i = periods.indexOf(period);
  return i > 0 ? periods[i - 1] : null;
}

function mentionedProvider(q: string): ProviderId | null {
  if (has(q, 'gemini', 'vertex', 'google')) return 'gemini_vertex';
  if (has(q, 'anthropic', 'claude')) return 'anthropic';
  return null;
}

/** "last month" / "previous month" / month names pick a period; otherwise the selected one. */
function mentionedPeriod(q: string, selected: PeriodKey): PeriodKey {
  if (has(q, 'last month', 'previous month', 'prior month')) return previousPeriod(selected) ?? selected;
  for (const p of getReportingPeriods()) {
    const monthName = new Date(`${p}-15T00:00:00Z`).toLocaleString('en-AU', { month: 'long', timeZone: 'UTC' }).toLowerCase();
    if (q.includes(monthName)) return p;
  }
  return selected;
}

function statusSentence(s: CostSummary): string {
  const parts = [`${formatCurrency(s.reconciledSpend)} is marked reconciled (sample status) and ${formatCurrency(s.estimatedOnlySpend)} is still an estimate`];
  if (s.unresolvedCount > 0) parts.push(`${formatNumber(s.unresolvedCount)} request${s.unresolvedCount === 1 ? '' : 's'} with unavailable usage ${s.unresolvedCount === 1 ? 'is' : 'are'} excluded rather than counted as $0`);
  return `Of this, ${parts.join('; ')}.`;
}

function baseFacts(period: PeriodKey, s: CostSummary, scope: string) {
  return [
    { label: 'Period', value: `${formatPeriodRange(period)} (Australia/Sydney)` },
    { label: 'Currency', value: 'AUD' },
    { label: 'Cost status', value: s.unresolvedCount > 0 ? `Estimated · ${formatNumber(s.unresolvedCount)} unresolved` : 'Estimated' },
    { label: 'Data scope', value: scope },
  ];
}

function scopeLabel(context: UserContext): string {
  if (can(context, 'view_company_totals')) return 'All teams (Company Admin)';
  const user = getCurrentUser(context);
  return `${user?.name ?? 'Your'} requests only (Individual User)`;
}

function periodFilters(period: PeriodKey, extra: Omit<SupportingFilters, 'from' | 'to'> = {}): SupportingFilters {
  const [from, to] = periodBounds(period);
  return { from, to, ...extra };
}

function summaryFigures(s: CostSummary): Record<string, number | null> {
  return {
    estimatedSpend: s.estimatedSpend,
    requestCount: s.requestCount,
    reconciledSpend: s.reconciledSpend,
    estimatedOnlySpend: s.estimatedOnlySpend,
    unresolvedCount: s.unresolvedCount,
  };
}

function emptyAnswer(intent: AssistantIntent, period: PeriodKey, context: UserContext, what: string): AssistantResponse {
  const s = summarize([]);
  return {
    intent,
    answer: [`There are no ${what} you can see for ${formatPeriod(period)}, so there is nothing to total.`],
    facts: baseFacts(period, s, scopeLabel(context)),
    figures: summaryFigures(s),
    followUps: SUGGESTED_QUESTIONS.slice(0, 2),
  };
}

// ---------------------------------------------------------------------------
// Intent handlers
// ---------------------------------------------------------------------------

function teamSpend(q: string, ctx: AssistantContext, context: UserContext): AssistantResponse {
  const period = mentionedPeriod(q, ctx.period);
  const records = selectRecords({ period }, context);
  if (records.length === 0) return emptyAnswer('team_spend', period, context, 'requests');
  const total = summarize(records);
  const isAdmin = can(context, 'view_all_teams');
  const byTeam = summarizeBy(records, (r) => r.teamId);
  const teams = currentTeams().filter((t) => byTeam.has(t.id));
  const rows = teams.map((t) => {
    const s = byTeam.get(t.id)!;
    return {
      team: t.name,
      code: t.code,
      requests: formatNumber(s.requestCount),
      spend: formatCurrency(s.estimatedSpend),
      share: formatPercent(safeRatio(s.estimatedSpend, total.estimatedSpend)),
      unresolved: formatNumber(s.unresolvedCount),
    };
  });
  const sorted = [...teams].sort((a, b) => byTeam.get(b.id)!.estimatedSpend - byTeam.get(a.id)!.estimatedSpend);

  const answer = isAdmin
    ? [
        `In ${formatPeriod(period)}, total estimated spend across ${teams.length} team${teams.length === 1 ? '' : 's'} was ${formatCurrency(total.estimatedSpend)} AUD. ` +
          sorted.map((t) => `${t.name} (${t.code}) accounted for ${formatCurrency(byTeam.get(t.id)!.estimatedSpend)}`).join(' and ') +
          '.',
        statusSentence(total),
      ]
    : [
        `As an Individual User you can only see your own requests, not other people’s or a team total. In ${formatPeriod(period)}, your ${formatNumber(total.requestCount)} requests (attributed to ${teams[0]?.name ?? 'your team'}) had an estimated cost of ${formatCurrency(total.estimatedSpend)} AUD.`,
        statusSentence(total),
      ];

  return {
    intent: 'team_spend',
    answer,
    facts: baseFacts(period, total, scopeLabel(context)),
    table: {
      caption: isAdmin ? 'Estimated spend by team' : 'Your requests by team code',
      columns: [
        { key: 'team', label: 'Team' },
        { key: 'code', label: 'Code' },
        { key: 'requests', label: 'Requests', align: 'right' },
        { key: 'spend', label: 'Estimated spend', align: 'right' },
        { key: 'share', label: 'Share', align: 'right' },
        { key: 'unresolved', label: 'Unresolved', align: 'right' },
      ],
      rows,
      footer: rows.length > 1 ? { team: 'Total', code: '', requests: formatNumber(total.requestCount), spend: formatCurrency(total.estimatedSpend), share: '100%', unresolved: formatNumber(total.unresolvedCount) } : undefined,
    },
    supporting: { label: 'View supporting requests', filters: periodFilters(period) },
    figures: { ...summaryFigures(total), ...Object.fromEntries(teams.map((t) => [`team:${t.id}`, byTeam.get(t.id)!.estimatedSpend])) },
    followUps: ['How much did we spend on Gemini?', 'Why did estimated spend increase compared with the previous period?'],
  };
}

function providerSpend(q: string, ctx: AssistantContext, context: UserContext): AssistantResponse {
  const period = mentionedPeriod(q, ctx.period);
  const providerId = mentionedProvider(q);
  const all = selectRecords({ period }, context);
  if (all.length === 0) return emptyAnswer('provider_spend', period, context, 'requests');
  const allSummary = summarize(all);
  const who = can(context, 'view_company_totals') ? 'we' : 'you';

  if (!providerId) {
    const byProvider = summarizeBy(all, (r) => r.providerId);
    const rows = providers.map((p) => {
      const s = byProvider.get(p.id) ?? summarize([]);
      return { provider: p.name, requests: formatNumber(s.requestCount), spend: formatCurrency(s.estimatedSpend), share: formatPercent(safeRatio(s.estimatedSpend, allSummary.estimatedSpend)) };
    });
    return {
      intent: 'provider_spend',
      answer: [
        `In ${formatPeriod(period)}, ${who} had ${formatCurrency(allSummary.estimatedSpend)} AUD in estimated spend across both providers: ` +
          providers.map((p) => `${p.name} ${formatCurrency((byProvider.get(p.id) ?? summarize([])).estimatedSpend)}`).join(' and ') +
          '.',
        statusSentence(allSummary),
      ],
      facts: baseFacts(period, allSummary, scopeLabel(context)),
      table: {
        caption: 'Estimated spend by provider',
        columns: [
          { key: 'provider', label: 'Provider' },
          { key: 'requests', label: 'Requests', align: 'right' },
          { key: 'spend', label: 'Estimated spend', align: 'right' },
          { key: 'share', label: 'Share', align: 'right' },
        ],
        rows,
      },
      supporting: { label: 'View supporting requests', filters: periodFilters(period) },
      figures: { ...summaryFigures(allSummary), ...Object.fromEntries(providers.map((p) => [`provider:${p.id}`, (byProvider.get(p.id) ?? summarize([])).estimatedSpend])) },
      followUps: ['How much did we spend on Gemini?', 'What did each team spend this month?'],
    };
  }

  const provider = providers.find((p) => p.id === providerId)!;
  const records = all.filter((r) => r.providerId === providerId);
  const s = summarize(records);
  const byModel = summarizeBy(records, (r) => r.modelId);
  const rows = models
    .filter((m) => m.providerId === providerId)
    .map((m) => {
      const ms = byModel.get(m.id) ?? summarize([]);
      return { model: m.displayName, requests: formatNumber(ms.requestCount), spend: formatCurrency(ms.estimatedSpend), unresolved: formatNumber(ms.unresolvedCount) };
    });
  const other = providers.find((p) => p.id !== providerId)!;
  return {
    intent: 'provider_spend',
    answer: [
      records.length === 0
        ? `There were no ${provider.name} requests ${who === 'we' ? 'in this workspace' : 'from you'} in ${formatPeriod(period)}, so estimated ${provider.name} spend was ${formatCurrency(0)}.`
        : `In ${formatPeriod(period)}, ${who} had ${formatCurrency(s.estimatedSpend)} AUD in estimated ${provider.name} spend from ${formatNumber(s.requestCount)} requests. That is ${formatPercent(safeRatio(s.estimatedSpend, allSummary.estimatedSpend))} of the ${formatCurrency(allSummary.estimatedSpend)} total; the rest is ${other.name}.`,
      ...(records.length > 0 ? [statusSentence(s)] : []),
    ],
    facts: [...baseFacts(period, s, scopeLabel(context)), { label: 'Provider', value: provider.name }],
    table: records.length
      ? {
          caption: `${provider.name} by model (illustrative names and rates)`,
          columns: [
            { key: 'model', label: 'Model' },
            { key: 'requests', label: 'Requests', align: 'right' },
            { key: 'spend', label: 'Estimated spend', align: 'right' },
            { key: 'unresolved', label: 'Unresolved', align: 'right' },
          ],
          rows,
        }
      : undefined,
    supporting: { label: 'View supporting requests', filters: periodFilters(period, { provider: providerId }) },
    figures: summaryFigures(s),
    followUps: [`How much did we spend on ${other.shortName === 'Claude' ? 'Anthropic' : other.shortName}?`, 'What did each team spend this month?'],
  };
}

function periodChange(ctx: AssistantContext, context: UserContext): AssistantResponse {
  const period = ctx.period;
  const prior = previousPeriod(period);
  const current = selectRecords({ period }, context);
  const cs = summarize(current);
  if (!prior) {
    return {
      intent: 'period_change',
      answer: [
        `${formatPeriod(period)} is the earliest month in the demo dataset, so there is no previous period to compare with. Choose a later month in the top bar to see a comparison.`,
      ],
      facts: baseFacts(period, cs, scopeLabel(context)),
      figures: summaryFigures(cs),
      followUps: ['What did each team spend this month?'],
    };
  }
  const previous = selectRecords({ period: prior }, context);
  const ps = summarize(previous);
  const delta = cs.estimatedSpend - ps.estimatedSpend;
  const pct = safeRatio(delta, ps.estimatedSpend);
  const avgNow = cs.averageCostPerCostedRequest;
  const avgBefore = ps.averageCostPerCostedRequest;

  const byModelNow = summarizeBy(current, (r) => r.modelId);
  const byModelBefore = summarizeBy(previous, (r) => r.modelId);
  const modelRows = models
    .map((m) => {
      const n = byModelNow.get(m.id) ?? summarize([]);
      const b = byModelBefore.get(m.id) ?? summarize([]);
      return { m, n, b, change: n.estimatedSpend - b.estimatedSpend };
    })
    .filter((x) => x.n.requestCount > 0 || x.b.requestCount > 0);
  const biggest = [...modelRows].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0];

  const direction = Math.abs(delta) < 0.005 ? 'was unchanged' : delta > 0 ? 'increased' : 'decreased';
  const answer: string[] = [];
  answer.push(
    direction === 'was unchanged'
      ? `Estimated spend was essentially unchanged: ${formatCurrency(ps.estimatedSpend)} in ${formatPeriod(prior)} and ${formatCurrency(cs.estimatedSpend)} in ${formatPeriod(period)} (AUD).`
      : `Estimated spend ${direction} from ${formatCurrency(ps.estimatedSpend)} in ${formatPeriod(prior)} to ${formatCurrency(cs.estimatedSpend)} in ${formatPeriod(period)}, a change of ${delta > 0 ? '+' : '−'}${formatCurrency(Math.abs(delta))}${pct === null ? '' : ` (${delta > 0 ? '+' : '−'}${formatPercent(Math.abs(pct), 1)})`} AUD.`,
  );
  const volumeChange = cs.requestCount - ps.requestCount;
  answer.push(
    `What the data shows: request volume ${volumeChange === 0 ? 'stayed at' : volumeChange > 0 ? 'rose from' : 'fell from'} ${volumeChange === 0 ? formatNumber(cs.requestCount) : `${formatNumber(ps.requestCount)} to ${formatNumber(cs.requestCount)}`}` +
      `, and the average estimated cost per costed request moved from ${formatCurrency(avgBefore, { precise: true })} to ${formatCurrency(avgNow, { precise: true })}, which reflects the mix of models and request sizes.` +
      (biggest && Math.abs(biggest.change) >= 0.005 ? ` The largest model-level change was ${biggest.m.displayName} (${biggest.change > 0 ? '+' : '−'}${formatCurrency(Math.abs(biggest.change))}).` : ''),
  );
  answer.push('These are observations about volume and model mix only. The dataset does not record why usage changed, so I can’t tell you the business reason.');
  if (cs.unresolvedCount > 0 || ps.unresolvedCount > 0)
    answer.push(`Both totals exclude requests with unavailable usage (${formatNumber(ps.unresolvedCount)} in ${formatPeriod(prior)}, ${formatNumber(cs.unresolvedCount)} in ${formatPeriod(period)}).`);

  return {
    intent: 'period_change',
    answer,
    facts: [
      { label: 'Compared', value: `${formatPeriodRange(prior)} vs ${formatPeriodRange(period)} (Australia/Sydney)` },
      { label: 'Currency', value: 'AUD' },
      { label: 'Cost status', value: 'Estimated (reconciliation states are sample data)' },
      { label: 'Data scope', value: scopeLabel(context) },
    ],
    table: {
      caption: 'Change by model (illustrative names and rates)',
      columns: [
        { key: 'model', label: 'Model' },
        { key: 'before', label: `${formatPeriod(prior)} requests`, align: 'right' },
        { key: 'now', label: `${formatPeriod(period)} requests`, align: 'right' },
        { key: 'beforeSpend', label: `${formatPeriod(prior)} spend`, align: 'right' },
        { key: 'nowSpend', label: `${formatPeriod(period)} spend`, align: 'right' },
        { key: 'change', label: 'Change', align: 'right' },
      ],
      rows: modelRows.map(({ m, n, b, change }) => ({
        model: m.displayName,
        before: formatNumber(b.requestCount),
        now: formatNumber(n.requestCount),
        beforeSpend: formatCurrency(b.estimatedSpend),
        nowSpend: formatCurrency(n.estimatedSpend),
        change: `${change >= 0 ? '+' : '−'}${formatCurrency(Math.abs(change))}`,
      })),
      footer: {
        model: 'Total',
        before: formatNumber(ps.requestCount),
        now: formatNumber(cs.requestCount),
        beforeSpend: formatCurrency(ps.estimatedSpend),
        nowSpend: formatCurrency(cs.estimatedSpend),
        change: `${delta >= 0 ? '+' : '−'}${formatCurrency(Math.abs(delta))}`,
      },
    },
    supporting: { label: 'View supporting requests', filters: { from: periodBounds(prior)[0], to: periodBounds(period)[1] } },
    figures: { currentSpend: cs.estimatedSpend, previousSpend: ps.estimatedSpend, change: delta, currentRequests: cs.requestCount, previousRequests: ps.requestCount },
    followUps: ['What did each team spend this month?', 'Show the requests behind this total.'],
  };
}

function describeFilters(f: SupportingFilters): string {
  const parts = [f.from === f.to ? f.from : `${f.from} to ${f.to}`];
  if (f.team) parts.push(currentTeams().find((t) => t.id === f.team)?.name ?? f.team);
  if (f.provider) parts.push(providers.find((p) => p.id === f.provider)?.name ?? f.provider);
  if (f.cost) parts.push(`cost ${f.cost}`);
  return parts.join(' · ');
}

function supportingRequests(q: string, ctx: AssistantContext, context: UserContext): AssistantResponse {
  // "this total" refers to the previous answer when there is one.
  const filters = ctx.previous && has(q, 'this', 'that', 'these', 'those') ? ctx.previous : periodFilters(mentionedPeriod(q, ctx.period), mentionedProvider(q) ? { provider: mentionedProvider(q)! } : {});
  const records: CostedUsageRecord[] = selectRecords({ period: filters.from.slice(0, 7) }, context);
  // A comparison spans two months, so gather both when needed.
  const range = filters.from.slice(0, 7) === filters.to.slice(0, 7) ? records : [...records, ...selectRecords({ period: filters.to.slice(0, 7) }, context)];
  const matching = range.filter(
    (r) => r.localDate >= filters.from && r.localDate <= filters.to && (!filters.team || r.teamId === filters.team) && (!filters.provider || r.providerId === filters.provider) && (!filters.cost || r.costStatus === filters.cost),
  );
  const s = summarize(matching);
  const byStatus: { label: string; count: number; amount: number | null }[] = [
    { label: 'Reconciled (sample)', count: s.reconciledCount, amount: s.reconciledSpend },
    { label: 'Estimated', count: s.estimatedOnlyCount, amount: s.estimatedOnlySpend },
    { label: 'Cost unavailable', count: s.unresolvedCount, amount: null },
  ];
  return {
    intent: 'supporting_requests',
    answer: [
      matching.length === 0
        ? 'There are no requests you can see that match that total.'
        : `${formatNumber(s.requestCount)} requests make up ${formatCurrency(s.estimatedSpend)} AUD in estimated spend for ${describeFilters(filters)}. Open them in Usage Explorer to sort, filter and inspect each request’s cost calculation.`,
    ],
    facts: [
      { label: 'Dates', value: `${filters.from} to ${filters.to} (Australia/Sydney)` },
      { label: 'Currency', value: 'AUD' },
      { label: 'Cost status', value: s.unresolvedCount > 0 ? `Estimated · ${formatNumber(s.unresolvedCount)} unresolved` : 'Estimated' },
      { label: 'Data scope', value: scopeLabel(context) },
    ],
    table: matching.length
      ? {
          caption: 'Requests by cost status',
          columns: [
            { key: 'status', label: 'Cost status' },
            { key: 'requests', label: 'Requests', align: 'right' },
            { key: 'spend', label: 'Estimated spend', align: 'right' },
          ],
          rows: byStatus.map((b) => ({ status: b.label, requests: formatNumber(b.count), spend: b.amount === null ? 'Not available' : formatCurrency(b.amount) })),
        }
      : undefined,
    supporting: { label: 'View supporting requests', filters },
    figures: summaryFigures(s),
    followUps: ['What does estimated cost mean?', 'Which requests have unavailable costs?'],
  };
}

function unresolved(q: string, ctx: AssistantContext, context: UserContext): AssistantResponse {
  const period = mentionedPeriod(q, ctx.period);
  const records = selectRecords({ period }, context);
  const s = summarize(records);
  const missing = records.filter((r) => r.costStatus === 'unavailable');
  const byProvider = summarizeBy(missing, (r) => r.providerId);
  return {
    intent: 'unresolved',
    answer: [
      missing.length === 0
        ? `Every request you can see in ${formatPeriod(period)} has a calculable estimated cost.`
        : `${formatNumber(missing.length)} of ${formatNumber(s.requestCount)} requests in ${formatPeriod(period)} have unavailable usage, so no cost can be calculated for them. They are excluded from the ${formatCurrency(s.estimatedSpend)} total and are not counted as $0.`,
    ],
    facts: baseFacts(period, s, scopeLabel(context)),
    table: missing.length
      ? {
          caption: 'Unavailable costs by provider',
          columns: [
            { key: 'provider', label: 'Provider' },
            { key: 'requests', label: 'Requests', align: 'right' },
          ],
          rows: providers.filter((p) => byProvider.has(p.id)).map((p) => ({ provider: p.name, requests: formatNumber(byProvider.get(p.id)!.requestCount) })),
        }
      : undefined,
    supporting: { label: 'View supporting requests', filters: periodFilters(period, { cost: 'unavailable' }) },
    figures: { unresolvedCount: missing.length, requestCount: s.requestCount },
    followUps: ['What does estimated cost mean?', 'What did each team spend this month?'],
  };
}

function estimatedMeaning(ctx: AssistantContext, context: UserContext): AssistantResponse {
  const pricing = pricingVersions[0];
  const s = summarize(selectRecords({ period: ctx.period }, context));
  return {
    intent: 'estimated_meaning',
    answer: [
      'Estimated cost is AxiomFlo’s calculation of what a request should cost, based on the tokens the provider reported and the rate for that model. It is a showback figure to explain usage, not a bill or an amount due.',
      'Formula: (input tokens × input rate per million + output tokens × output rate per million) ÷ 1,000,000. Failed requests are costed from whatever usage was measured. If usage wasn’t reported, the cost is shown as unavailable instead of $0.',
      'A reconciled status would mean the estimate has been checked against the provider’s billing record. In this demo, reconciliation states are sample data and no billing records are compared.',
    ],
    facts: [
      { label: 'Pricing version', value: pricing.label },
      { label: 'Currency', value: 'AUD' },
      { label: 'Cost status', value: 'Estimated · reconciliation is sample data' },
      { label: 'Data scope', value: scopeLabel(context) },
    ],
    table: {
      caption: 'Illustrative rates (AUD per million tokens, not current provider pricing)',
      columns: [
        { key: 'model', label: 'Model' },
        { key: 'input', label: 'Input rate', align: 'right' },
        { key: 'output', label: 'Output rate', align: 'right' },
      ],
      rows: pricing.rates.map((r) => ({
        model: models.find((m) => m.id === r.modelId)?.displayName ?? r.modelId,
        input: formatCurrency(r.inputPerMillion),
        output: formatCurrency(r.outputPerMillion),
      })),
    },
    supporting: { label: 'View supporting requests', filters: periodFilters(ctx.period) },
    figures: summaryFigures(s),
    followUps: ['Show the requests behind this total.', 'What did each team spend this month?'],
  };
}

function scorecardFacts(period: PeriodKey, context: UserContext, sc: Scorecard) {
  return [
    { label: 'Period', value: `${formatPeriodRange(period)} (Australia/Sydney)` },
    { label: 'Currency', value: 'AUD' },
    { label: 'Cost status', value: sc.economics.unresolvedRequests > 0 ? `Estimated · ${formatNumber(sc.economics.unresolvedRequests)} unresolved` : 'Estimated' },
    { label: 'Data scope', value: scopeLabel(context) },
  ];
}

const SCORECARD_PAGE = { label: 'Open the FinOps Scorecard', to: '/scorecard' };

function optimise(q: string, ctx: AssistantContext, context: UserContext): AssistantResponse {
  const period = mentionedPeriod(q, ctx.period);
  const { scorecard: sc } = buildDemoScorecard(period, context);
  if (sc.economics.requests === 0) return emptyAnswer('optimise', period, context, 'requests');
  const [top, second] = sc.levers;
  const answer = [
    `${can(context, 'view_company_totals') ? 'Your FinOps score' : 'The FinOps score for your own requests'} for ${formatPeriod(period)} is ${sc.score}/100 (grade ${sc.grade}). ` +
      `Of ${formatCurrency(sc.economics.spend)} estimated spend, up to ${formatCurrency(sc.combinedSavings)} (${formatPercent(sc.combinedSavingsShare)}) could be saved if all five levers were pulled, allowing for overlap.`,
    top.savings > 0
      ? `The biggest lever is ${top.name.toLowerCase()}: about ${formatCurrency(top.savings)} across ${formatNumber(top.affectedRequests)} requests. ${top.action}` +
        (second && second.savings > 0 ? ` Next is ${second.name.toLowerCase()}, at about ${formatCurrency(second.savings)}.` : '')
      : 'None of the five levers finds anything to save in this period.',
    'Each lever is estimated on its own under the assumptions shown on the scorecard, so the amounts overlap. A cheaper model or shorter prompt doesn’t promise the same quality, so test a change on real tasks first.',
  ];
  return {
    intent: 'optimise',
    answer,
    facts: scorecardFacts(period, context, sc),
    table: {
      caption: 'Optimisation levers by savings potential',
      columns: [
        { key: 'rank', label: '#', align: 'right' },
        { key: 'lever', label: 'Lever' },
        { key: 'effort', label: 'Effort' },
        { key: 'requests', label: 'Requests', align: 'right' },
        { key: 'savings', label: 'Est. savings', align: 'right' },
        { key: 'share', label: 'Of spend', align: 'right' },
      ],
      rows: sc.levers.map((l) => ({ rank: String(l.rank), lever: l.name, effort: l.effort, requests: formatNumber(l.affectedRequests), savings: formatCurrency(l.savings), share: formatPercent(l.savingsShare, 1) })),
      footer: { rank: '', lever: 'All five, allowing for overlap', effort: '', requests: '', savings: formatCurrency(sc.combinedSavings), share: formatPercent(sc.combinedSavingsShare, 1) },
    },
    page: SCORECARD_PAGE,
    figures: { score: sc.score, estimatedSpend: sc.economics.spend, combinedSavings: sc.combinedSavings, requestCount: sc.economics.requests, ...Object.fromEntries(sc.levers.map((l) => [l.id, l.savings])) },
    followUps: ['What does each workflow cost in tokens?', 'Why did estimated spend increase compared with the previous period?'],
  };
}

function unitEconomicsAnswer(q: string, ctx: AssistantContext, context: UserContext): AssistantResponse {
  const period = mentionedPeriod(q, ctx.period);
  const { scorecard: sc } = buildDemoScorecard(period, context);
  if (sc.economics.requests === 0) return emptyAnswer('unit_economics', period, context, 'requests');
  const e = sc.economics;
  const top = sc.workflows[0];
  const answer = [
    `In ${formatPeriod(period)}, each request with a known cost averaged ${formatCurrency(e.costPerRequest, { precise: true })}, and each successful request ${formatCurrency(e.costPerSuccessfulRequest, { precise: true })} once failed requests are counted. ` +
      `That’s ${formatCurrency(e.costPerMillionTokens)} per million tokens and ${formatCurrency(e.costPerActivePerson)} per active person.`,
    `${top.label} is the costliest workflow at ${formatCurrency(top.spend)} (${formatPercent(top.share)} of spend), ${formatCurrency(top.costPerRequest, { precise: true })} per request.` +
      (e.outputToInputRatio !== null && e.outputToInputRatio < 0.1 ? ' Prompts are far larger than answers here, so input tokens drive most of the cost.' : ''),
  ];
  return {
    intent: 'unit_economics',
    answer,
    facts: scorecardFacts(period, context, sc),
    table: {
      caption: 'Token cost per workflow',
      columns: [
        { key: 'workflow', label: 'Workflow' },
        { key: 'requests', label: 'Requests', align: 'right' },
        { key: 'input', label: 'Input cost', align: 'right' },
        { key: 'output', label: 'Output cost', align: 'right' },
        { key: 'perRequest', label: 'Per request', align: 'right' },
        { key: 'spend', label: 'Spend', align: 'right' },
      ],
      rows: sc.workflows.map((w) => ({ workflow: w.label, requests: formatNumber(w.requests), input: formatCurrency(w.inputSpend), output: formatCurrency(w.outputSpend), perRequest: formatCurrency(w.costPerRequest, { precise: true }), spend: formatCurrency(w.spend) })),
    },
    page: SCORECARD_PAGE,
    figures: { estimatedSpend: e.spend, requestCount: e.requests, costPerRequest: e.costPerRequest, costPerSuccessfulRequest: e.costPerSuccessfulRequest, costPerMillionTokens: e.costPerMillionTokens },
    followUps: ['How can we cut our AI costs?', 'What did each team spend this month?'],
  };
}

function readOnly(): AssistantResponse {
  return {
    intent: 'read_only',
    answer: [
      'I can’t make changes. This demo assistant is read-only: it doesn’t change budgets, settings, teams, users or provider connections. Company Admins can manage teams on Teams & Users and connections on AI Providers.',
      SCOPE_TEXT,
    ],
    facts: [],
    figures: {},
    followUps: SUGGESTED_QUESTIONS.slice(0, 3),
  };
}

function unsupported(q: string): AssistantResponse {
  const answer = ['I can’t answer that from the demo data, and I won’t guess.', SCOPE_TEXT];
  if (has(q, 'cheaper', 'cheapest', 'better', 'quality', 'switch', 'best model', 'recommend'))
    answer.splice(1, 0, 'I can show illustrative rates and spend, but a lower price doesn’t mean a model gives equivalent quality for your use case, so I don’t recommend models.');
  if (has(q, 'invoice', 'bill', 'owe', 'pay', 'amount due'))
    answer.splice(1, 0, 'AxiomFlo shows estimated spend for showback. It doesn’t produce invoices, final bills or payments.');
  return { intent: 'unsupported', answer, facts: [], figures: {}, followUps: SUGGESTED_QUESTIONS.slice(0, 3) };
}

/** Pure function behind getAssistantResponse (no latency). */
export function buildAssistantResponse(question: string, ctx: AssistantContext, context: UserContext): AssistantResponse {
  const q = normalise(question);
  switch (detectIntent(question)) {
    case 'optimise':
      return optimise(q, ctx, context);
    case 'unit_economics':
      return unitEconomicsAnswer(q, ctx, context);
    case 'team_spend':
      return teamSpend(q, ctx, context);
    case 'provider_spend':
      return providerSpend(q, ctx, context);
    case 'period_change':
      return periodChange(ctx, context);
    case 'supporting_requests':
      return supportingRequests(q, ctx, context);
    case 'unresolved':
      return unresolved(q, ctx, context);
    case 'estimated_meaning':
      return estimatedMeaning(ctx, context);
    case 'read_only':
      return readOnly();
    default:
      return unsupported(q);
  }
}

const LATENCY_MS = import.meta.env?.MODE === 'test' ? 0 : 600;

/** Deterministic demo answer. No live LLM, no network, no data changes. */
export function getAssistantResponse(question: string, ctx: AssistantContext, context: UserContext): Promise<AssistantResponse> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(buildAssistantResponse(question, ctx, context));
      } catch (e) {
        reject(e);
      }
    }, LATENCY_MS),
  );
}
