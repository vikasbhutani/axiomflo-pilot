/**
 * Upgrade Analysis for the demo workspace (Acme sample data), with the same shapes as
 * the AxiomFlo API's /api/upgrade-analysis/* so one view serves both workspaces.
 *
 * Uses the same role-scoped records as every other demo page: a Company Admin analyses
 * the whole company; an Individual User only their own requests. Saved analyses live in
 * this browser (sample data, nothing sent anywhere) and keep an append-only audit trail.
 */
import { currentTeams, demoStore } from '../data/demoStore';
import { applications, company, DEMO_REPORTING_DATE } from '../data/mockData';
import { demoAgents, demoDefaultRules, demoProjects, demoRegionOf, demoUpgradeCatalogue, demoWorkflows, toDemoUpgradeRecord } from '../data/upgradeFixtures';
import { can } from '../lib/permissions';
import {
  addDays,
  estimateUpgrade,
  parseEstimateRequest,
  renderCsvReport,
  renderMarkdownReport,
  resolveTimeWindow,
  SCOPE_LEVEL_LABELS,
  SCOPE_LEVELS,
  UPGRADE_RULES,
  type EstimateContext,
  type SavedUpgradeAnalysis,
  type ScopeLevel,
  type ScopeOption,
  type UpgradeAnalysis,
  type UpgradeEstimateRequest,
  type UpgradeExportResponse,
  type UpgradeModelsResponse,
  type UpgradeUsageRecord,
} from '../lib/upgrade';
import type { UserContext } from '../types';
import { getCurrentUser, selectUsage } from './mockService';

const STORAGE_KEY = 'axiomflo-demo:upgrade-analyses'; // also cleared by demoStore.reset()

/** The client the Upgrade Analysis view talks to: the demo service or the AxiomFlo API. */
export interface UpgradeAnalysisClient {
  models(): Promise<UpgradeModelsResponse>;
  estimate(request: UpgradeEstimateRequest): Promise<UpgradeAnalysis>;
  save(request: UpgradeEstimateRequest, options: { title?: string; idempotencyKey: string }): Promise<SavedUpgradeAnalysis>;
  get(id: string): Promise<SavedUpgradeAnalysis>;
  exportReport(id: string, format: 'markdown' | 'csv', idempotencyKey: string): Promise<UpgradeExportResponse>;
}

export class UpgradeClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UpgradeClientError';
  }
}

function records(context: UserContext, from: string, to: string): UpgradeUsageRecord[] {
  return selectUsage({ startDate: from, endDate: to }, context).map(toDemoUpgradeRecord);
}

/** Scope options for what the viewer can see: everything for an admin, only levels in their own requests otherwise. */
function scopeOptions(context: UserContext, seen: UpgradeUsageRecord[]): EstimateContext['scopes'] {
  const present = (level: ScopeLevel, all: ScopeOption[]) => {
    if (can(context, 'view_all_teams')) return all;
    const ids = new Set(seen.map((r) => ({ team: r.teamId, project: r.projectId, application: r.applicationId, workflow: r.workflowId, agent: r.agentId, environment: r.environment, company: null })[level]));
    return all.filter((o) => ids.has(o.id));
  };
  const teams = currentTeams().map((t) => ({ id: t.id, label: t.name }));
  const visibleTeams = can(context, 'view_all_teams') ? teams : teams.filter((t) => t.id === getCurrentUser(context)?.teamId);
  return {
    team: visibleTeams,
    project: present('project', demoProjects),
    application: present('application', applications.map((a) => ({ id: a.id, label: a.name }))),
    workflow: present('workflow', demoWorkflows),
    agent: present('agent', demoAgents),
    environment: present('environment', [
      { id: 'production', label: 'Production' },
      { id: 'staging', label: 'Staging' },
      { id: 'development', label: 'Development' },
    ]),
  };
}

const companyLabel = (context: UserContext) => (can(context, 'view_company_totals') ? `All teams in ${company.name}` : `${getCurrentUser(context)?.name ?? 'Your'} requests only`);

/** Everything the view's selectors need, like GET /api/upgrade-analysis/models. */
export function buildDemoUpgradeModels(context: UserContext): UpgradeModelsResponse {
  const seen = records(context, addDays(DEMO_REPORTING_DATE, -(UPGRADE_RULES.maxWindowDays - 1)), DEMO_REPORTING_DATE);
  const counts = new Map<string, number>();
  const costs = new Map<string, number>();
  for (const r of seen) {
    counts.set(r.modelId, (counts.get(r.modelId) ?? 0) + 1);
    costs.set(r.modelId, (costs.get(r.modelId) ?? 0) + (r.cost ?? 0));
  }
  const scopes = scopeOptions(context, seen);
  return {
    currency: 'AUD',
    today: DEMO_REPORTING_DATE,
    currentModels: demoUpgradeCatalogue
      .filter((m) => counts.has(m.id))
      .map((m) => ({ ...m, observedRequests: counts.get(m.id)!, observedCost: costs.get(m.id) ?? 0 }))
      .sort((a, b) => b.observedCost - a.observedCost || b.observedRequests - a.observedRequests),
    candidateModels: demoUpgradeCatalogue.filter((m) => m.upgradePaths.length > 0),
    scopes: SCOPE_LEVELS.map((level) => ({ level, label: level === 'company' ? companyLabel(context) : SCOPE_LEVEL_LABELS[level], options: level === 'company' ? [] : (scopes[level] ?? []) })),
    defaultRules: demoDefaultRules,
    notes: ['Sample data: candidate models, prices and expectations are illustrative, not current provider pricing or benchmarks.', `The demo’s “today” is ${DEMO_REPORTING_DATE}.`],
  };
}

/** Like POST /api/upgrade-analysis/estimate. Throws UpgradeInputError or UpgradeAccessError. */
export function buildDemoUpgradeEstimate(body: unknown, context: UserContext, now = new Date()): UpgradeAnalysis {
  const request = parseEstimateRequest(body);
  const window = resolveTimeWindow(request.timeWindow, DEMO_REPORTING_DATE);
  const seen = records(context, window.from, window.to);
  const all = records(context, addDays(DEMO_REPORTING_DATE, -(UPGRADE_RULES.maxWindowDays - 1)), DEMO_REPORTING_DATE);
  return estimateUpgrade(request, {
    catalogue: demoUpgradeCatalogue,
    records: seen,
    scopes: scopeOptions(context, all),
    companyLabel: companyLabel(context),
    currency: 'AUD',
    today: DEMO_REPORTING_DATE,
    regionOf: demoRegionOf,
    now: now.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Saved analyses (this browser only)
// ---------------------------------------------------------------------------

interface StoredDoc {
  saved: SavedUpgradeAnalysis;
  key: string;
  inputs: string;
  exportKeys: Record<string, SavedUpgradeAnalysis['audit'][number]>;
}

function readAll(): StoredDoc[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredDoc[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(docs: StoredDoc[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(docs.slice(-50)));
  } catch {
    // Storage may be unavailable; the analysis still shows for this session.
  }
}

const memory: { docs: StoredDoc[] | null } = { docs: null };
// "Reset demo" clears the stored analyses too; reload from storage after any demo change.
demoStore.subscribe(() => {
  memory.docs = null;
});
const docs = () => (memory.docs ??= readAll());
const persist = () => writeAll(docs());

function newId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return `ua_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const visible = (context: UserContext, s: SavedUpgradeAnalysis) => s.companyId === company.id && (can(context, 'view_all_teams') || s.createdBy === context.userId);

export function saveDemoUpgrade(body: unknown, context: UserContext, { title, idempotencyKey }: { title?: string; idempotencyKey: string }, now = new Date()): SavedUpgradeAnalysis {
  const analysis = buildDemoUpgradeEstimate(body, context, now);
  const inputs = JSON.stringify([title ?? null, analysis.inputs]);
  const key = `${context.userId}:${idempotencyKey}`;
  const existing = docs().find((d) => d.key === key);
  if (existing) {
    if (existing.inputs !== inputs) throw new UpgradeClientError('That analysis was already saved with different inputs.', 409);
    return existing.saved;
  }
  const user = getCurrentUser(context);
  const saved: SavedUpgradeAnalysis = {
    id: newId(),
    companyId: company.id,
    title: title?.trim() || `${analysis.current.displayName} → ${analysis.candidate.displayName}, ${analysis.scope.label}`,
    status: 'draft',
    createdBy: context.userId,
    createdAt: now.toISOString(),
    authorisation: { uid: context.userId, role: context.role, teamIds: user ? [user.teamId] : [], readOnly: false },
    pricing: {
      current: { version: analysis.current.pricing?.pricingVersion ?? null, source: analysis.current.pricing?.pricingSource ?? null },
      candidate: { version: analysis.candidate.pricing?.pricingVersion ?? null, source: analysis.candidate.pricing?.pricingSource ?? null },
    },
    analysis,
    audit: [{ at: now.toISOString(), actorUid: context.userId, action: 'saved', detail: 'Saved as a draft.' }],
  };
  docs().push({ saved, key, inputs, exportKeys: {} });
  persist();
  return saved;
}

export function getDemoUpgrade(id: string, context: UserContext): SavedUpgradeAnalysis {
  const doc = docs().find((d) => d.saved.id === id);
  if (!doc || !visible(context, doc.saved)) throw new UpgradeClientError('Analysis not found.', 404);
  return doc.saved;
}

export function exportDemoUpgrade(id: string, format: 'markdown' | 'csv', context: UserContext, idempotencyKey: string, now = new Date()): UpgradeExportResponse {
  const doc = docs().find((d) => d.saved.id === id);
  if (!doc || !visible(context, doc.saved)) throw new UpgradeClientError('Analysis not found.', 404);
  const key = `${context.userId}:${idempotencyKey}`;
  let entry = doc.exportKeys[key];
  if (!entry) {
    entry = { at: now.toISOString(), actorUid: context.userId, action: 'exported', detail: `Exported as ${format === 'csv' ? 'CSV' : 'Markdown'}.` };
    doc.saved.audit.push(entry);
    doc.exportKeys[key] = entry;
    persist();
  }
  const s = doc.saved;
  return {
    id: s.id,
    format,
    filename: `${s.id}.${format === 'csv' ? 'csv' : 'md'}`,
    contentType: format === 'csv' ? 'text/csv' : 'text/markdown',
    content: format === 'csv' ? renderCsvReport(s.analysis) : renderMarkdownReport(s.analysis, { title: s.title, savedId: s.id, exportedAt: entry.at }),
    exportedAt: entry.at,
  };
}

/** Forgets saved demo analyses (used by tests and "Reset demo"). */
export function resetDemoUpgrades() {
  memory.docs = [];
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

const LATENCY_MS = import.meta.env?.MODE === 'test' ? 0 : 250;
const later = <T>(work: () => T) =>
  new Promise<T>((resolve, reject) =>
    setTimeout(() => {
      try {
        resolve(work());
      } catch (e) {
        reject(e);
      }
    }, LATENCY_MS),
  );

export function demoUpgradeClient(context: UserContext): UpgradeAnalysisClient {
  return {
    models: () => later(() => buildDemoUpgradeModels(context)),
    estimate: (request) => later(() => buildDemoUpgradeEstimate(request, context)),
    save: (request, options) => later(() => saveDemoUpgrade(request, context, options)),
    get: (id) => later(() => getDemoUpgrade(id, context)),
    exportReport: (id, format, key) => later(() => exportDemoUpgrade(id, format, context, key)),
  };
}
