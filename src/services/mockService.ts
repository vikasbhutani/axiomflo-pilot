/**
 * MOCK SERVICE LAYER — no network calls, no production APIs.
 *
 * These async functions stand in for a future backend. They read the local
 * demonstration dataset, apply role scoping (as a real backend would have to),
 * and return the same shapes the pages render. Swap their bodies for real
 * HTTP calls later; keep the role checks on the server when you do.
 */
import {
  applications,
  company,
  DEMO_REPORTING_DATE,
  department,
  models,
  pricingVersions,
  providerConnections,
  providers,
  teams,
  usageRecords,
  users,
} from '../data/mockData';
import { costBreakdown, summarize, summarizeBy, type CostSummary } from '../lib/calculations';
import { periodBounds, toLocalDate } from '../lib/format';
import { can, scopeUsageRecords, visibleTeamIds } from '../lib/permissions';
import type {
  CostedUsageRecord,
  PeriodKey,
  ProviderConnection,
  ProviderId,
  Team,
  User,
  UserContext,
  UsageRecord,
} from '../types';

/** Simulated latency so loading states are visible. Disabled under tests. */
const LATENCY_MS = import.meta.env?.MODE === 'test' ? 0 : 250;

function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

export class AccessDeniedError extends Error {
  constructor(message = 'This demo role cannot view that information.') {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

// ---------------------------------------------------------------------------
// Enrichment
// ---------------------------------------------------------------------------

function principalName(record: UsageRecord): string {
  if (record.principal.type === 'user') return users.find((u) => u.id === record.principal.id)?.name ?? 'Unknown user';
  return applications.find((a) => a.id === record.principal.id)?.name ?? 'Unknown application';
}

export function toCostedRecord(record: UsageRecord): CostedUsageRecord {
  const localDate = toLocalDate(record.timestamp);
  const breakdown = costBreakdown(record, localDate, pricingVersions);
  return {
    ...record,
    estimatedCost: breakdown?.total ?? null,
    pricingVersionId: breakdown?.pricingVersionId ?? null,
    principalName: principalName(record),
    teamName: teams.find((t) => t.id === record.teamId)?.name ?? record.teamCode,
    modelName: models.find((m) => m.id === record.modelId)?.displayName ?? record.modelId,
    providerName: providers.find((p) => p.id === record.providerId)?.name ?? record.providerId,
    localDate,
  };
}

const allCostedRecords: CostedUsageRecord[] = usageRecords.map(toCostedRecord);

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface ReportFilters {
  period: PeriodKey;
  /** `'all'` or a team ID. Ignored (forced to the user's team) for Individual Users. */
  teamId?: string;
  /** `'all'` or a provider ID. */
  providerId?: ProviderId | 'all';
}

/** Every record the user may see, matching the filters. The single source for all reports. */
export function selectRecords(filters: ReportFilters, context: UserContext): CostedUsageRecord[] {
  const [start, end] = periodBounds(filters.period);
  const allowedTeams = visibleTeamIds(context, users, teams.map((t) => t.id));
  const teamFilter = filters.teamId && filters.teamId !== 'all' ? filters.teamId : null;
  return scopeUsageRecords(allCostedRecords, context, users).filter(
    (r) =>
      r.localDate >= start &&
      r.localDate <= end &&
      allowedTeams.includes(r.teamId) &&
      (teamFilter === null || r.teamId === teamFilter) &&
      (!filters.providerId || filters.providerId === 'all' || r.providerId === filters.providerId),
  );
}

// ---------------------------------------------------------------------------
// Public mock service functions
// ---------------------------------------------------------------------------

export interface WorkspaceInfo {
  companyName: string;
  departmentName: string;
  currency: 'AUD';
  timezone: string;
  demoReportingDate: string;
  periods: PeriodKey[];
  defaultPeriod: PeriodKey;
}

/** Reporting periods are derived from the dataset, newest first. */
export function getReportingPeriods(): PeriodKey[] {
  const keys = new Set(allCostedRecords.map((r) => r.localDate.slice(0, 7)));
  return [...keys].sort().reverse();
}

export function getWorkspaceInfo(): WorkspaceInfo {
  const periods = getReportingPeriods();
  return {
    companyName: company.name,
    departmentName: department.name,
    currency: company.reportingCurrency,
    timezone: company.reportingTimezone,
    demoReportingDate: DEMO_REPORTING_DATE,
    periods,
    defaultPeriod: periods[0],
  };
}

export function getCurrentUser(context: UserContext): User | undefined {
  return users.find((u) => u.id === context.userId);
}

export interface TeamSlice {
  teamId: string;
  name: string;
  code: string;
  summary: CostSummary;
}

export interface ProviderSlice {
  providerId: ProviderId;
  name: string;
  summary: CostSummary;
}

export interface DailyPoint {
  date: string;
  estimatedSpend: number;
  requestCount: number;
  unresolvedCount: number;
}

export interface ProviderConnectionSummary {
  connection: ProviderConnection;
  providerName: string;
  summary: CostSummary;
}

export interface OnboardingItem {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

export interface OverviewData {
  filters: ReportFilters;
  summary: CostSummary;
  previousPeriod: PeriodKey | null;
  previousSummary: CostSummary | null;
  daily: DailyPoint[];
  byTeam: TeamSlice[];
  byProvider: ProviderSlice[];
  recentRequests: CostedUsageRecord[];
  connections: ProviderConnectionSummary[];
  onboarding: OnboardingItem[];
  scopeDescription: string;
}

function dailySeries(records: CostedUsageRecord[], period: PeriodKey): DailyPoint[] {
  const [start, end] = periodBounds(period);
  const byDay = summarizeBy(records, (r) => r.localDate);
  const points: DailyPoint[] = [];
  const startDay = Number(start.slice(8));
  const endDay = Number(end.slice(8));
  for (let d = startDay; d <= endDay; d++) {
    const date = `${period}-${String(d).padStart(2, '0')}`;
    const s = byDay.get(date);
    points.push({ date, estimatedSpend: s?.estimatedSpend ?? 0, requestCount: s?.requestCount ?? 0, unresolvedCount: s?.unresolvedCount ?? 0 });
  }
  return points;
}

function previousPeriodOf(period: PeriodKey): PeriodKey | null {
  const periods = getReportingPeriods();
  const index = periods.indexOf(period);
  return index >= 0 && index + 1 < periods.length ? periods[index + 1] : null;
}

export function buildOverview(filters: ReportFilters, context: UserContext): OverviewData {
  const effectiveFilters: ReportFilters = { ...filters, teamId: can(context, 'view_all_teams') ? filters.teamId ?? 'all' : 'all' };
  const records = selectRecords(effectiveFilters, context);
  const summary = summarize(records);

  const previousPeriod = previousPeriodOf(filters.period);
  const previousSummary = previousPeriod ? summarize(selectRecords({ ...effectiveFilters, period: previousPeriod }, context)) : null;

  const allowedTeamIds = visibleTeamIds(context, users, teams.map((t) => t.id));
  const teamGroups = summarizeBy(records, (r) => r.teamId);
  const byTeam: TeamSlice[] = teams
    .filter((t) => allowedTeamIds.includes(t.id))
    .filter((t) => !effectiveFilters.teamId || effectiveFilters.teamId === 'all' || t.id === effectiveFilters.teamId)
    .map((t) => ({ teamId: t.id, name: t.name, code: t.code, summary: teamGroups.get(t.id) ?? summarize([]) }));

  const providerGroups = summarizeBy(records, (r) => r.providerId);
  const byProvider: ProviderSlice[] = providers
    .filter((p) => !filters.providerId || filters.providerId === 'all' || p.id === filters.providerId)
    .map((p) => ({ providerId: p.id, name: p.name, summary: providerGroups.get(p.id) ?? summarize([]) }));

  const connections: ProviderConnectionSummary[] = providerConnections
    .filter((c) => !filters.providerId || filters.providerId === 'all' || c.providerId === filters.providerId)
    .map((c) => ({
      // Configuration details are admin-only; other roles just see status.
      connection: can(context, 'view_provider_settings') ? c : { ...c, configSummary: '' },
      providerName: providers.find((p) => p.id === c.providerId)?.name ?? c.providerId,
      summary: providerGroups.get(c.providerId) ?? summarize([]),
    }));

  const isAdmin = context.role === 'company_admin';
  const onboarding: OnboardingItem[] = isAdmin
    ? [
        { id: 'workspace', label: 'Demo workspace created', done: true, href: '/settings' },
        { id: 'teams', label: 'Teams and usage codes assigned', done: true, href: '/teams' },
        { id: 'providers', label: 'Provider connections tested (simulated)', done: providerConnections.every((c) => c.lastSimulatedTestAt !== null), href: '/providers' },
        { id: 'unresolved', label: 'Review requests with unavailable cost', done: false, href: '/usage' },
        { id: 'showback', label: 'Preview the first monthly showback', done: false, href: '/showback' },
      ]
    : [
        { id: 'team', label: 'Assigned to a team', done: true, href: '/teams' },
        { id: 'usage', label: 'Browse your own request details', done: false, href: '/usage' },
        { id: 'assistant', label: 'Ask the Cost Assistant a question', done: false, href: '/assistant' },
      ];

  const user = getCurrentUser(context);
  const userTeam = teams.find((t) => t.id === user?.teamId);
  const scopeDescription = isAdmin
    ? effectiveFilters.teamId && effectiveFilters.teamId !== 'all'
      ? `${teams.find((t) => t.id === effectiveFilters.teamId)?.name ?? 'Selected team'} only`
      : `All teams in ${department.name}`
    : `Your own requests in ${userTeam?.name ?? 'your team'}`;

  return {
    filters: effectiveFilters,
    summary,
    previousPeriod,
    previousSummary,
    daily: dailySeries(records, filters.period),
    byTeam,
    byProvider,
    recentRequests: [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 8),
    connections,
    onboarding,
    scopeDescription,
  };
}

export function getOverview(filters: ReportFilters, context: UserContext): Promise<OverviewData> {
  return respond(buildOverview(filters, context));
}

export function getUsage(filters: ReportFilters, context: UserContext): Promise<CostedUsageRecord[]> {
  return respond(selectRecords(filters, context));
}

/** Teams the user may see. Individual Users only see their own team. */
export function getTeams(context: UserContext): Promise<Team[]> {
  const allowed = visibleTeamIds(context, users, teams.map((t) => t.id));
  return respond(teams.filter((t) => allowed.includes(t.id)));
}

export function getProviderConnections(context: UserContext): Promise<ProviderConnection[]> {
  if (!can(context, 'view_provider_settings')) return Promise.reject(new AccessDeniedError('Only Company Admins can view provider connection settings.'));
  return respond(providerConnections);
}

/** Static lookups shared by filter controls. */
export const lookups = { teams, providers, models, pricingVersions };
