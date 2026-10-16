/**
 * MOCK SERVICE LAYER — no network calls, no production APIs.
 *
 * These async functions stand in for a future backend. They read the local
 * demonstration dataset, apply role scoping (as a real backend would have to),
 * and return the same shapes the pages render. Swap their bodies for real
 * HTTP calls later; keep the role checks on the server when you do.
 */
import { applications, DEMO_PERSONAS, DEMO_REPORTING_DATE, department, models, pricingVersions, providers, usageRecords } from '../data/mockData';
import { currentTeams, currentUsers, demoStore, newAuditEvent } from '../data/demoStore';
import { costBreakdown, pricingVersionFor, summarize, summarizeBy, type CostBreakdown, type CostSummary } from '../lib/calculations';
import { periodBounds, toLocalDate } from '../lib/format';
import { can, scopeUsageRecords, visibleTeamIds } from '../lib/permissions';
import type {
  AuditEvent,
  CostStatus,
  Role,
  CostedUsageRecord,
  PricingVersion,
  RequestStatus,
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

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
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
  if (record.principal.type === 'user') return currentUsers().find((u) => u.id === record.principal.id)?.name ?? 'Unknown user';
  return applications.find((a) => a.id === record.principal.id)?.name ?? 'Unknown application';
}

/** Attaches current display names (people and teams can be renamed in the demo). */
function withNames(record: CostedUsageRecord): CostedUsageRecord {
  return { ...record, principalName: principalName(record), teamName: currentTeams().find((t) => t.id === record.teamId)?.name ?? record.teamCode };
}

export function toCostedRecord(record: UsageRecord): CostedUsageRecord {
  const localDate = toLocalDate(record.timestamp);
  const breakdown = costBreakdown(record, localDate, pricingVersions);
  return {
    ...record,
    estimatedCost: breakdown?.total ?? null,
    pricingVersionId: breakdown?.pricingVersionId ?? null,
    principalName: principalName(record),
    teamName: currentTeams().find((t) => t.id === record.teamId)?.name ?? record.teamCode,
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

interface BaseFilters {
  startDate: string;
  endDate: string;
  teamId?: string;
  providerId?: ProviderId | 'all';
}

/**
 * Every record the user may see within a Sydney date range, team and provider.
 * The single source for all reports, so every screen agrees.
 */
function selectScoped(filters: BaseFilters, context: UserContext): CostedUsageRecord[] {
  const allowedTeams = visibleTeamIds(context, currentUsers(), currentTeams().map((t) => t.id));
  const teamFilter = filters.teamId && filters.teamId !== 'all' ? filters.teamId : null;
  return scopeUsageRecords(allCostedRecords, context, currentUsers())
    .filter(
      (r) =>
        r.localDate >= filters.startDate &&
        r.localDate <= filters.endDate &&
        allowedTeams.includes(r.teamId) &&
        (teamFilter === null || r.teamId === teamFilter) &&
        (!filters.providerId || filters.providerId === 'all' || r.providerId === filters.providerId),
    )
    .map(withNames);
}

/** Every record the user may see for a reporting period and filters. */
export function selectRecords(filters: ReportFilters, context: UserContext): CostedUsageRecord[] {
  const [startDate, endDate] = periodBounds(filters.period);
  return selectScoped({ startDate, endDate, teamId: filters.teamId, providerId: filters.providerId }, context);
}

export interface UsageFilters {
  /** Inclusive Australia/Sydney dates (YYYY-MM-DD). */
  startDate: string;
  endDate: string;
  teamId?: string;
  providerId?: ProviderId | 'all';
  requestStatus?: RequestStatus | 'all';
  costStatus?: CostStatus | 'all';
  /** Case-insensitive match on the request ID. */
  search?: string;
}

export function selectUsage(filters: UsageFilters, context: UserContext): CostedUsageRecord[] {
  const query = filters.search?.trim().toLowerCase() ?? '';
  return selectScoped(filters, context)
    .filter(
      (r) =>
        (!filters.requestStatus || filters.requestStatus === 'all' || r.requestStatus === filters.requestStatus) &&
        (!filters.costStatus || filters.costStatus === 'all' || r.costStatus === filters.costStatus) &&
        (query === '' || r.id.toLowerCase().includes(query)),
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
    companyName: demoStore.get().companyName,
    departmentName: department.name,
    currency: 'AUD',
    timezone: 'Australia/Sydney',
    demoReportingDate: DEMO_REPORTING_DATE,
    periods,
    defaultPeriod: periods[0],
  };
}

export function getCurrentUser(context: UserContext): User | undefined {
  return currentUsers().find((u) => u.id === context.userId);
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

  const teams = currentTeams();
  const allowedTeamIds = visibleTeamIds(context, currentUsers(), teams.map((t) => t.id));
  const teamGroups = summarizeBy(records, (r) => r.teamId);
  const byTeam: TeamSlice[] = teams
    .filter((t) => allowedTeamIds.includes(t.id))
    .filter((t) => !effectiveFilters.teamId || effectiveFilters.teamId === 'all' || t.id === effectiveFilters.teamId)
    .map((t) => ({ teamId: t.id, name: t.name, code: t.code, summary: teamGroups.get(t.id) ?? summarize([]) }));

  const providerGroups = summarizeBy(records, (r) => r.providerId);
  const byProvider: ProviderSlice[] = providers
    .filter((p) => !filters.providerId || filters.providerId === 'all' || p.id === filters.providerId)
    .map((p) => ({ providerId: p.id, name: p.name, summary: providerGroups.get(p.id) ?? summarize([]) }));

  const providerConnections = demoStore.get().connections.map(withConfigSummary);
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
        { id: 'unresolved', label: 'Review requests with unavailable cost', done: false, href: '/usage?cost=unavailable' },
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

export interface UsageResult {
  records: CostedUsageRecord[];
  summary: CostSummary;
}

/** Requests matching the Usage Explorer filters, newest first, with totals from the shared calculations. */
export function getUsage(filters: UsageFilters, context: UserContext): Promise<UsageResult> {
  const records = selectUsage(filters, context);
  return respond({ records, summary: summarize(records) });
}

/** Earliest and latest Sydney dates in the dataset, for date-range controls. */
export function getDataDateBounds(): [string, string] {
  const dates = allCostedRecords.map((r) => r.localDate).sort();
  return [dates[0], dates[dates.length - 1]];
}

export interface RequestDetail {
  record: CostedUsageRecord;
  breakdown: CostBreakdown | null;
  pricingVersion: PricingVersion | null;
  /** Plain-language notes about anything missing or unresolved. Never invented values. */
  missingInformation: string[];
}

export function buildRequestDetail(requestId: string, context: UserContext): RequestDetail {
  // Look up within the caller's scope only, so out-of-scope IDs look the same as unknown ones.
  const found = scopeUsageRecords(allCostedRecords, context, currentUsers()).find((r) => r.id === requestId);
  if (!found) throw new NotFoundError('This request does not exist or is not visible to your role.');
  const record = withNames(found);
  const pricingVersion = pricingVersionFor(record.localDate, pricingVersions);
  const breakdown = costBreakdown(record, record.localDate, pricingVersions);

  const missingInformation: string[] = [];
  if (record.inputTokens === null) missingInformation.push('The provider did not report input tokens for this request.');
  if (record.outputTokens === null) missingInformation.push('The provider did not report output tokens for this request.');
  if (record.inputTokens !== null && record.outputTokens !== null && !breakdown) missingInformation.push('No illustrative rate exists for this model in the pricing version in effect.');
  if (!breakdown) missingInformation.push('Estimated cost is not available and is not counted as $0. It appears under unresolved records.');
  if (record.costStatus === 'estimated') missingInformation.push('Not yet reconciled (sample state). The estimate may change once matched to a provider billing record.');

  return { record, breakdown, pricingVersion, missingInformation };
}

export function getRequestDetail(requestId: string, context: UserContext): Promise<RequestDetail> {
  try {
    return respond(buildRequestDetail(requestId, context));
  } catch (error) {
    return Promise.reject(error);
  }
}

// ---------------------------------------------------------------------------
// Teams & Users (simulated admin actions)
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors)[0] ?? 'Please check the form.');
    this.name = 'ValidationError';
  }
}

function requirePermission(context: UserContext, permission: Parameters<typeof can>[1], message: string) {
  if (!can(context, permission)) throw new AccessDeniedError(message);
}

function actorName(context: UserContext): string {
  return getCurrentUser(context)?.name ?? 'Unknown user';
}

/** Runs a synchronous mutation and returns it as a simulated async call. */
function act<T>(fn: () => T): Promise<T> {
  try {
    return respond(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}

export interface TeamMember extends User {
  /** Requests this person made under this team's code in the period. Not shown to other Individual Users. */
  requestCount: number;
}

export interface TeamOverview {
  team: Team;
  members: TeamMember[];
  summary: CostSummary;
}

export interface TeamsData {
  departmentName: string;
  teams: TeamOverview[];
  canManage: boolean;
}

/** Department, teams, members and period totals the user may see. */
export function buildTeams(period: PeriodKey, context: UserContext): TeamsData {
  const teams = currentTeams();
  const allowed = visibleTeamIds(context, currentUsers(), teams.map((t) => t.id));
  const records = selectRecords({ period }, context);
  const isAdmin = can(context, 'manage_teams');
  return {
    departmentName: department.name,
    canManage: isAdmin,
    teams: teams
      .filter((t) => allowed.includes(t.id))
      .map((team) => {
        const teamRecords = records.filter((r) => r.teamId === team.id);
        const members = currentUsers()
          .filter((u) => u.teamId === team.id)
          // Individual Users see who is on their team, but only their own activity.
          .map((u) => ({ ...u, requestCount: isAdmin || u.id === context.userId ? teamRecords.filter((r) => r.principal.type === 'user' && r.principal.id === u.id).length : 0 }));
        return { team, members, summary: summarize(teamRecords) };
      }),
  };
}

export function getTeams(period: PeriodKey, context: UserContext): Promise<TeamsData> {
  return respond(buildTeams(period, context));
}

export function validateTeamName(name: string, teamId: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a team name.';
  if (trimmed.length > 60) return 'Use 60 characters or fewer.';
  if (currentTeams().some((t) => t.id !== teamId && t.name.toLowerCase() === trimmed.toLowerCase())) return 'Another team already uses this name.';
  return null;
}

export function renameTeam(teamId: string, name: string, context: UserContext): Promise<Team> {
  return act(() => {
    requirePermission(context, 'manage_teams', 'Only Company Admins can rename teams.');
    const team = currentTeams().find((t) => t.id === teamId);
    if (!team) throw new NotFoundError('Team not found.');
    const error = validateTeamName(name, teamId);
    if (error) throw new ValidationError({ name: error });
    const trimmed = name.trim();
    demoStore.update((s) => ({
      ...s,
      teamNames: { ...s.teamNames, [teamId]: trimmed },
      audit: [newAuditEvent(actorName(context), 'Team renamed', `${team.code}: “${team.name}” → “${trimmed}”`), ...s.audit],
    }));
    return { ...team, name: trimmed };
  });
}

export interface InviteInput {
  name: string;
  email: string;
  role: Role;
  teamId: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateInvite(input: InviteInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.name.trim()) errors.name = 'Enter a name.';
  else if (input.name.trim().length > 80) errors.name = 'Use 80 characters or fewer.';
  const email = input.email.trim().toLowerCase();
  if (!email) errors.email = 'Enter an email address.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Enter a valid email address, like name@company.com.';
  else if (currentUsers().some((u) => u.email.toLowerCase() === email)) errors.email = 'Someone with this email is already in the workspace.';
  if (input.role !== 'company_admin' && input.role !== 'individual_user') errors.role = 'Choose a role.';
  if (!currentTeams().some((t) => t.id === input.teamId)) errors.teamId = 'Choose a team.';
  return errors;
}

/** Adds an "invited" user. No email is sent: this is a demo. */
export function inviteUser(input: InviteInput, context: UserContext): Promise<User> {
  return act(() => {
    requirePermission(context, 'invite_users', 'Only Company Admins can invite users.');
    const errors = validateInvite(input);
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    const user: User = {
      id: `u-invited-${Date.now()}`,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      role: input.role,
      teamId: input.teamId,
      status: 'invited',
      title: 'Invited (demo)',
    };
    const team = currentTeams().find((t) => t.id === input.teamId)!;
    demoStore.update((s) => ({
      ...s,
      users: [...s.users, user],
      audit: [newAuditEvent(actorName(context), 'User invited (simulated)', `${user.name} <${user.email}> to ${team.name} as ${input.role === 'company_admin' ? 'Company Admin' : 'Individual User'}. No email sent.`), ...s.audit],
    }));
    return user;
  });
}

/** Demo personas power the role switcher, so they can't be suspended or moved. */
export function isDemoPersona(userId: string): boolean {
  return (Object.values(DEMO_PERSONAS) as string[]).includes(userId);
}

export function changeUserTeam(userId: string, teamId: string, context: UserContext): Promise<User> {
  return act(() => {
    requirePermission(context, 'manage_teams', 'Only Company Admins can change team assignments.');
    const user = currentUsers().find((u) => u.id === userId);
    const team = currentTeams().find((t) => t.id === teamId);
    if (!user || !team) throw new NotFoundError('User or team not found.');
    if (isDemoPersona(userId)) throw new ValidationError({ teamId: 'Demo personas used by the role switcher keep their team.' });
    if (user.teamId === teamId) return user;
    const from = currentTeams().find((t) => t.id === user.teamId);
    const updated = { ...user, teamId };
    demoStore.update((s) => ({
      ...s,
      users: s.users.map((u) => (u.id === userId ? updated : u)),
      audit: [newAuditEvent(actorName(context), 'Team assignment changed', `${user.name}: ${from?.code ?? 'none'} → ${team.code}. Past requests keep their original team code.`), ...s.audit],
    }));
    return updated;
  });
}

export function setUserStatus(userId: string, status: 'active' | 'suspended', context: UserContext): Promise<User> {
  return act(() => {
    requirePermission(context, 'manage_teams', 'Only Company Admins can suspend or reactivate users.');
    const user = currentUsers().find((u) => u.id === userId);
    if (!user) throw new NotFoundError('User not found.');
    if (isDemoPersona(userId)) throw new ValidationError({ status: 'Demo personas used by the role switcher can’t be suspended.' });
    const updated = { ...user, status };
    demoStore.update((s) => ({
      ...s,
      users: s.users.map((u) => (u.id === userId ? updated : u)),
      audit: [newAuditEvent(actorName(context), status === 'suspended' ? 'User suspended' : 'User reactivated', user.name), ...s.audit],
    }));
    return updated;
  });
}

// ---------------------------------------------------------------------------
// AI Providers (simulated connections; no live calls, no stored secrets)
// ---------------------------------------------------------------------------

function withConfigSummary(c: ProviderConnection): ProviderConnection {
  const configSummary =
    c.providerId === 'gemini_vertex'
      ? [c.projectId && `Project ${c.projectId}`, c.region, c.identitySummary].filter(Boolean).join(' · ')
      : [c.maskedCredential && `API key ${c.maskedCredential} (sample, not a real key)`].filter(Boolean).join(' · ');
  return { ...c, configSummary };
}

export interface ProviderCard {
  connection: ProviderConnection;
  providerName: string;
  summary: CostSummary;
}

export function buildProviderCards(period: PeriodKey, context: UserContext): ProviderCard[] {
  requirePermission(context, 'view_provider_settings', 'Only Company Admins can view provider connection settings.');
  const groups = summarizeBy(selectRecords({ period }, context), (r) => r.providerId);
  return demoStore.get().connections.map((c) => ({
    connection: withConfigSummary(c),
    providerName: providers.find((p) => p.id === c.providerId)?.name ?? c.providerId,
    summary: groups.get(c.providerId) ?? summarize([]),
  }));
}

export function getProviderConnections(period: PeriodKey, context: UserContext): Promise<ProviderCard[]> {
  return act(() => buildProviderCards(period, context));
}

export interface GeminiConfigInput {
  projectId: string;
  region: string;
}

export interface AnthropicConfigInput {
  displayName: string;
  notes: string;
}

export const GEMINI_REGIONS = ['australia-southeast1', 'australia-southeast2', 'asia-southeast1', 'us-central1', 'europe-west4'];
const PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export function validateGeminiConfig(input: GeminiConfigInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!PROJECT_ID_PATTERN.test(input.projectId.trim())) errors.projectId = 'Use 6–30 lowercase letters, digits or hyphens, starting with a letter (Google Cloud project ID format).';
  if (!GEMINI_REGIONS.includes(input.region)) errors.region = 'Choose a region.';
  return errors;
}

export function validateAnthropicConfig(input: AnthropicConfigInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.displayName.trim()) errors.displayName = 'Enter a display name.';
  else if (input.displayName.trim().length > 60) errors.displayName = 'Use 60 characters or fewer.';
  if (input.notes.length > 500) errors.notes = 'Use 500 characters or fewer.';
  return errors;
}

function updateConnection(connectionId: string, context: UserContext, action: string, detail: string, patch: Partial<ProviderConnection>): ProviderConnection {
  const existing = demoStore.get().connections.find((c) => c.id === connectionId);
  if (!existing) throw new NotFoundError('Connection not found.');
  const updated = { ...existing, ...patch };
  demoStore.update((s) => ({
    ...s,
    connections: s.connections.map((c) => (c.id === connectionId ? updated : c)),
    audit: [newAuditEvent(actorName(context), action, detail), ...s.audit],
  }));
  return withConfigSummary(updated);
}

export function saveGeminiConfig(connectionId: string, input: GeminiConfigInput, context: UserContext): Promise<ProviderConnection> {
  return act(() => {
    requirePermission(context, 'view_provider_settings', 'Only Company Admins can change provider connections.');
    const errors = validateGeminiConfig(input);
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    return updateConnection(connectionId, context, 'Connection settings updated (simulated)', `Gemini on Vertex AI: project ${input.projectId.trim()}, ${input.region}`, { projectId: input.projectId.trim(), region: input.region });
  });
}

export function saveAnthropicConfig(connectionId: string, input: AnthropicConfigInput, context: UserContext): Promise<ProviderConnection> {
  return act(() => {
    requirePermission(context, 'view_provider_settings', 'Only Company Admins can change provider connections.');
    const errors = validateAnthropicConfig(input);
    if (Object.keys(errors).length > 0) throw new ValidationError(errors);
    return updateConnection(connectionId, context, 'Connection settings updated (simulated)', `Anthropic: display name “${input.displayName.trim()}”`, { displayName: input.displayName.trim(), notes: input.notes.trim() });
  });
}

export type SimulatedOutcome = 'success' | 'failure';

/**
 * Pretends to test a connection. No provider is contacted: the outcome is
 * whatever the admin chose to simulate, after a short delay.
 */
export function simulateConnectionTest(connectionId: string, outcome: SimulatedOutcome, context: UserContext): Promise<ProviderConnection> {
  return new Promise((resolve, reject) => {
    setTimeout(
      () => {
        try {
          requirePermission(context, 'view_provider_settings', 'Only Company Admins can test provider connections.');
          const c = demoStore.get().connections.find((x) => x.id === connectionId);
          if (!c) throw new NotFoundError('Connection not found.');
          if (c.status === 'disabled') throw new ValidationError({ status: 'Enable the connection before testing it.' });
          const name = providers.find((p) => p.id === c.providerId)?.name ?? c.providerId;
          resolve(
            updateConnection(connectionId, context, 'Connection test (simulated)', `${name} test ${outcome === 'success' ? 'succeeded' : 'failed'}.`, {
              lastSimulatedTestAt: new Date().toISOString(),
              lastSimulatedTestResult: outcome,
            }),
          );
        } catch (error) {
          reject(error);
        }
      },
      import.meta.env?.MODE === 'test' ? 0 : 1200,
    );
  });
}

export function setConnectionEnabled(connectionId: string, enabled: boolean, context: UserContext): Promise<ProviderConnection> {
  return act(() => {
    requirePermission(context, 'view_provider_settings', 'Only Company Admins can change provider connections.');
    const c = demoStore.get().connections.find((x) => x.id === connectionId);
    if (!c) throw new NotFoundError('Connection not found.');
    const name = providers.find((p) => p.id === c.providerId)?.name ?? c.providerId;
    return updateConnection(connectionId, context, enabled ? 'Connection enabled (simulated)' : 'Connection disabled (simulated)', name, { status: enabled ? 'connected_demo' : 'disabled' });
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function validateCompanyName(name: string): string | null {
  if (!name.trim()) return 'Enter a company name.';
  if (name.trim().length > 80) return 'Use 80 characters or fewer.';
  return null;
}

export function saveCompanyName(name: string, context: UserContext): Promise<string> {
  return act(() => {
    requirePermission(context, 'manage_teams', 'Only Company Admins can change company details.');
    const error = validateCompanyName(name);
    if (error) throw new ValidationError({ name: error });
    const previous = demoStore.get().companyName;
    const trimmed = name.trim();
    demoStore.update((s) => ({ ...s, companyName: trimmed, audit: [newAuditEvent(actorName(context), 'Company name changed', `“${previous}” → “${trimmed}”`), ...s.audit] }));
    return trimmed;
  });
}

export function getAuditEvents(context: UserContext): Promise<AuditEvent[]> {
  return act(() => {
    requirePermission(context, 'manage_teams', 'Only Company Admins can view the audit log.');
    return demoStore.get().audit;
  });
}

/** Restores the seed dataset and clears simulated edits. Usage records never change. */
export function resetDemoWorkspace(): Promise<void> {
  return act(() => demoStore.reset());
}

/** Lookups shared by filter controls. Read at call time so renamed teams show up. */
export function getLookups() {
  return { teams: currentTeams(), providers, models, pricingVersions };
}
