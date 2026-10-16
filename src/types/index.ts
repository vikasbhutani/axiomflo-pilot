/**
 * Shared domain types for the AxiomFlo pilot UI.
 *
 * Everything here describes DEMONSTRATION data. None of these shapes is a
 * contract with a real backend yet; they are a starting point for one.
 */

export type Role = 'company_admin' | 'individual_user';

export type UserStatus = 'active' | 'invited' | 'suspended';

export type ProviderId = 'gemini_vertex' | 'anthropic';

/** Whether the provider call itself succeeded. */
export type RequestStatus = 'succeeded' | 'failed';

/**
 * Cost status of a single request (sample states only; no real provider
 * billing reconciliation is performed in this prototype).
 *
 * - `reconciled`: estimate matched against a (simulated) provider billing record.
 * - `estimated`: cost calculated from usage + illustrative rates, not yet reconciled.
 * - `unavailable`: usage measurements are missing, so no cost can be calculated.
 *   These are "unresolved" and are never counted as zero spend.
 */
export type CostStatus = 'reconciled' | 'estimated' | 'unavailable';

export interface Company {
  id: string;
  name: string;
  reportingCurrency: 'AUD';
  reportingTimezone: string;
}

export interface Department {
  id: string;
  companyId: string;
  name: string;
}

export interface Team {
  id: string;
  departmentId: string;
  name: string;
  /** Unique usage code. Read-only in the pilot to keep attribution stable. */
  code: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  teamId: string;
  status: UserStatus;
  title: string;
}

/** A non-human caller, e.g. a CI bot, that sends requests under a team code. */
export interface Application {
  id: string;
  name: string;
  teamId: string;
}

export interface Model {
  id: string;
  providerId: ProviderId;
  displayName: string;
}

export interface Provider {
  id: ProviderId;
  name: string;
  shortName: string;
}

export interface PricingRate {
  modelId: string;
  /** Illustrative AUD per one million input tokens. NOT current provider pricing. */
  inputPerMillion: number;
  /** Illustrative AUD per one million output tokens. NOT current provider pricing. */
  outputPerMillion: number;
}

export interface PricingVersion {
  id: string;
  label: string;
  /** Inclusive, Australia/Sydney calendar date (YYYY-MM-DD). */
  effectiveFrom: string;
  currency: 'AUD';
  rates: PricingRate[];
}

export type ConnectionStatus = 'connected_demo' | 'not_configured' | 'disabled';

export interface ProviderConnection {
  id: string;
  providerId: ProviderId;
  displayName: string;
  status: ConnectionStatus;
  /** ISO timestamp of the last simulated connection test. */
  lastSimulatedTestAt: string | null;
  /** Human-readable, already-masked configuration summary. Never a secret. */
  configSummary: string;
}

export type Principal =
  | { type: 'user'; id: string }
  | { type: 'application'; id: string };

export interface UsageRecord {
  /** Full request identifier. */
  id: string;
  /** ISO 8601 timestamp in UTC. */
  timestamp: string;
  principal: Principal;
  teamId: string;
  /** Team code captured at request time (historical attribution). */
  teamCode: string;
  providerId: ProviderId;
  modelId: string;
  /** `null` means the provider did not report a measurement. */
  inputTokens: number | null;
  outputTokens: number | null;
  requestStatus: RequestStatus;
  costStatus: CostStatus;
}

/** A usage record with its calculated cost and display helpers attached. */
export interface CostedUsageRecord extends UsageRecord {
  /** Full-precision estimated cost in AUD, or `null` when it cannot be calculated. */
  estimatedCost: number | null;
  pricingVersionId: string | null;
  principalName: string;
  teamName: string;
  modelName: string;
  providerName: string;
  /** Australia/Sydney calendar date (YYYY-MM-DD). */
  localDate: string;
}

export interface UserContext {
  userId: string;
  role: Role;
}

/** A reporting period, as an Australia/Sydney calendar month: `YYYY-MM`. */
export type PeriodKey = string;
