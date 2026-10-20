/**
 * Upgrade Analysis over a real workspace: the model catalogue from the gateway's list
 * prices, and usage records from the UsageService, in the reporting currency.
 *
 * Real records come from people's AxiomFlo keys, so they carry a team but no project,
 * application, workflow, agent or environment. Those scopes and rules are offered only
 * when a workspace records them.
 */
import { anthropicListPrices, anthropicPricePrefix, PRICE_VERSION } from '../gateway/prices.js';
import { baseGeminiModel, geminiListPrices, VERTEX_PRICE_VERSION } from '../gateway/vertexPrices.js';
import { localDate } from '../reports/months.js';
import type { ExchangeRateView, UsageView } from '../reports/service.js';
import { addDays } from './engine.js';
import type { ModelFeature, ModelPricing, ModelProfile, UpgradePath, UpgradeUsageRecord } from './types.js';

const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic', gemini_vertex: 'Gemini on Vertex AI' };
const ALL_FEATURES: ModelFeature[] = ['tool_use', 'structured_output', 'vision', 'long_context', 'prompt_caching'];

/** "claude-sonnet-5-5" → "Claude Sonnet 5.5"; "gemini-2.5-flash" → "Gemini 2.5 Flash". */
export function modelDisplayName(id: string): string {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  if (/^gemini-[a-z0-9.-]+$/.test(id))
    return id
      .split('-')
      .map((p) => (/^\d/.test(p) ? p : p[0].toUpperCase() + p.slice(1)))
      .join(' ');
  return id;
}

/** Family and numeric version, e.g. sonnet / 5.5, flash-lite / 3.1. */
export function familyOf(id: string): { family: string; version: number | null } {
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?/.exec(id);
  if (claude) return { family: claude[1], version: Number(`${claude[2]}.${claude[3] ?? 0}`) };
  const gemini = /^gemini-(\d+(?:\.\d+)?)-([a-z-]+)$/.exec(id);
  if (gemini) return { family: gemini[2], version: Number(gemini[1]) };
  return { family: id, version: null };
}

/** The catalogue ID a recorded model is priced under (dated snapshots → base model). */
export function catalogueId(providerId: string, modelId: string): string {
  if (providerId === 'anthropic') return anthropicPricePrefix(modelId) ?? modelId;
  if (providerId === 'gemini_vertex') return baseGeminiModel(modelId);
  return modelId;
}

/** The exchange rate for a month: its own, else the latest earlier one, else the earliest. */
export function rateFor(month: string, rates: ExchangeRateView[]): number | null {
  const sorted = [...rates].sort((a, b) => a.month.localeCompare(b.month));
  if (sorted.length === 0) return null;
  const earlier = sorted.filter((r) => r.month <= month);
  return (earlier[earlier.length - 1] ?? sorted[0]).rate;
}

export interface Money {
  currency: string;
  /** Reporting-currency units per USD by month; null when amounts stay in USD. */
  rateForMonth: (month: string) => number | null;
  note: string | null;
}

export function moneyFor(reportingCurrency: string, rates: ExchangeRateView[]): Money {
  if (reportingCurrency === 'USD') return { currency: 'USD', rateForMonth: () => null, note: null };
  const usable = rates.filter((r) => r.currency === reportingCurrency && r.rate > 0);
  if (usable.length === 0) return { currency: 'USD', rateForMonth: () => null, note: `No ${reportingCurrency} exchange rate is set yet, so amounts are in USD.` };
  return { currency: reportingCurrency, rateForMonth: (m) => rateFor(m, usable), note: null };
}

function pathsFor(candidate: string, provider: string, others: { id: string; providerId: string }[]): UpgradePath[] {
  const c = familyOf(candidate);
  return others
    .filter((o) => o.id !== candidate)
    .map((o): UpgradePath => {
      if (o.providerId !== provider) return { fromModelId: o.id, compatibility: 'needs_changes', note: 'Different provider: needs a new integration and its own testing.' };
      const f = familyOf(o.id);
      if (f.family === c.family && c.version !== null && f.version !== null && c.version > f.version)
        return { fromModelId: o.id, compatibility: 'drop_in', note: 'Same model family, newer version: same API. Check the provider’s migration notes for changed behaviour.' };
      return { fromModelId: o.id, compatibility: 'needs_changes', note: 'Same provider, different model tier or an older version: same API, but expect differences in quality, speed and tool use.' };
    });
}

/**
 * Every priced model (in the reporting currency at today’s month rate), plus any model
 * seen in usage that has no price (pricing `null`, so it can't be a priced candidate).
 */
export function buildCatalogue({ today, money, observed }: { today: string; money: Money; observed: { id: string; providerId: string }[] }): ModelProfile[] {
  const rate = money.rateForMonth(today.slice(0, 7));
  const k = rate ?? 1;
  const conversionNote = rate === null ? null : `Prices converted from USD at ${rate} ${money.currency} per USD (the ${today.slice(0, 7)} rate).`;
  const price = (input: number, cached: number, output: number, version: string, source: string, validUntil: string | null): ModelPricing => ({
    currency: money.currency,
    inputPerMillion: input * k,
    outputPerMillion: output * k,
    cachedInputPerMillion: cached * k,
    // Thinking tokens are billed as output by both providers.
    reasoningPerMillion: null,
    pricingVersion: version,
    pricingSource: source,
    validUntil,
    conversionNote,
  });
  const priced: { id: string; providerId: string; pricing: ModelPricing }[] = [
    ...anthropicListPrices().map((p) => ({ id: p.prefix, providerId: 'anthropic', pricing: price(p.input, p.cacheRead, p.output, PRICE_VERSION, 'Anthropic list price (platform.claude.com/docs/en/about-claude/pricing)', null) })),
    ...geminiListPrices(today).map((p) => ({
      id: p.model,
      providerId: 'gemini_vertex',
      pricing: price(p.input, p.cachedInput, p.output, VERTEX_PRICE_VERSION, 'Vertex AI list price, global endpoint', p.until ? addDays(p.until, -1) : null),
    })),
  ];
  const known = new Set(priced.map((p) => p.id));
  const unpriced = observed.filter((o, i) => !known.has(o.id) && observed.findIndex((x) => x.id === o.id) === i).map((o) => ({ ...o, pricing: null }));
  const everything = [...priced, ...unpriced];
  return everything.map((m) => ({
    id: m.id,
    providerId: m.providerId,
    providerName: PROVIDER_NAMES[m.providerId] ?? m.providerId,
    displayName: modelDisplayName(m.id),
    version: String(familyOf(m.id).version ?? 'not recorded'),
    status: m.id.includes('preview') ? 'preview' : 'ga',
    pricing: m.pricing,
    features: ALL_FEATURES,
    regions: null,
    environments: null,
    expected: { latencyChangePct: null, errorRatePct: null, outputTokenChangePct: null, reasoningTokensPerRequest: null },
    upgradePaths: pathsFor(m.id, m.providerId, everything),
    qualityEvidence: null,
  }));
}

/** A real usage record, normalised for the analysis. */
export function toUpgradeRecord(r: UsageView, timeZone: string, money: Money): UpgradeUsageRecord {
  const date = localDate(r.timestamp, timeZone);
  const rate = money.rateForMonth(date.slice(0, 7));
  return {
    id: r.id,
    localDate: date,
    teamId: r.teamId,
    projectId: null,
    applicationId: null,
    workflowId: null,
    agentId: null,
    environment: null,
    providerId: r.providerId,
    modelId: catalogueId(r.providerId, r.modelId),
    // Cache writes are new prompt tokens, so the candidate prices them as input.
    inputTokens: r.inputTokens === null ? null : r.inputTokens + (r.cacheWriteTokens ?? 0),
    cachedInputTokens: r.cacheReadTokens ?? 0,
    outputTokens: r.outputTokens,
    reasoningTokens: 0,
    requestStatus: r.requestStatus,
    isRetry: false,
    isFallback: false,
    latencyMs: r.latencyMs,
    cost: r.estimatedCostUsd === null ? null : r.estimatedCostUsd * (rate ?? 1),
    costStatus: r.costStatus,
    pricingVersion: r.priceVersion,
    requiredFeatures: [],
  };
}
