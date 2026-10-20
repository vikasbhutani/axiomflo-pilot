/**
 * Upgrade Analysis, for active members: what moving a model dependency to a newer
 * model version would cost. Estimates only; nothing here changes routing or models.
 *
 *   GET  /api/upgrade-analysis/models        current and candidate models, pricing, compatibility, scopes
 *   POST /api/upgrade-analysis/estimate      UpgradeEstimateRequest → { analysis }
 *   POST /api/upgrade-analysis/save          { request, title?, status? } → { saved }   (not for view-only members)
 *   GET  /api/upgrade-analysis/:id           a saved analysis
 *   POST /api/upgrade-analysis/:id/export    { format? } → a Markdown or CSV report (audited)
 *
 * Every request re-checks the membership. Usage is read with the same scoping as the
 * report pages (admins: everyone's; individual users: their own), and the scope must
 * be one the member may see. Saves re-run the estimate on the server, so a client can
 * never store figures it made up. POSTs that create something accept an Idempotency-Key.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { getMember, type ActiveMember } from '../membership/requireMember.js';
import { dayRangeUtc, localDate } from '../reports/months.js';
import type { UsageService } from '../reports/service.js';
import { addDays, estimateUpgrade, parseEstimateRequest, resolveTimeWindow, UpgradeAccessError, UpgradeInputError, UPGRADE_RULES, type EstimateContext } from '../upgrade/engine.js';
import { buildCatalogue, moneyFor, toUpgradeRecord } from '../upgrade/realWorkspace.js';
import { renderCsvReport, renderMarkdownReport } from '../upgrade/report.js';
import { IDEMPOTENCY_KEY, SAVED_ID, type UpgradeAnalysisStore } from '../upgrade/store.js';
import { SCOPE_LEVELS, type UpgradeEstimateRequest, type UpgradeExportResponse, type UpgradeModelsResponse, type UpgradeSavedResponse } from '../upgrade/types.js';

const bad = (message: string) => new ApiError(400, 'bad_request', message);
const NOT_RECORDED = ['project', 'application', 'workflow', 'agent', 'environment'] as const;

export function upgradeAnalysisRouter({
  authenticate,
  requireMember,
  usage,
  store,
  companyId,
  logger,
  now = () => new Date(),
}: {
  authenticate: RequestHandler;
  requireMember: RequestHandler;
  usage: UsageService;
  store: UpgradeAnalysisStore;
  companyId: string;
  logger: Logger;
  now?: () => Date;
}): Router {
  const router = Router();
  const member = [authenticate, requireMember];
  const perUser = (name: string, limit: number) => rateLimit({ name, limit, windowMs: 60_000, key: (locals) => getMember(locals).membership.uid });

  const run = (work: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = await work(req, res);
      if (!res.headersSent) res.json(body);
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      if (error instanceof UpgradeInputError) return next(bad(error.message));
      if (error instanceof UpgradeAccessError) return next(new ApiError(403, 'forbidden', error.message));
      logger.error('upgrade analysis failed', { requestId: res.locals.requestId, errorName: (error as Error)?.name, code: (error as { code?: unknown })?.code });
      return next(new ApiError(503, 'membership_unavailable', 'We couldn’t run this analysis just now. Please try again.'));
    }
  };

  const viewerOf = (m: ActiveMember) => ({ uid: m.membership.uid, role: m.membership.role });
  const today = (m: ActiveMember) => localDate(now(), m.company.reportingTimezone);

  /** Usage between two local dates, in the reporting currency, scoped to the member. */
  async function workspace(m: ActiveMember, from: string, to: string) {
    const tz = m.company.reportingTimezone;
    const [startIso, endIso] = dayRangeUtc(from, to, tz);
    const [rates, result] = await Promise.all([usage.listRates(companyId), usage.listUsage(companyId, viewerOf(m), { startIso, endIso })]);
    const money = moneyFor(m.company.reportingCurrency, rates);
    const records = result.records.map((r) => toUpgradeRecord(r, tz, money));
    const catalogue = buildCatalogue({ today: today(m), money, observed: records.map((r) => ({ id: r.modelId, providerId: r.providerId })) });
    const notes = [money.note, result.truncated ? 'There were more usage records than one analysis reads, so some are missing; choose a shorter window.' : null, result.skipped ? `${result.skipped} stored records couldn’t be read and were left out.` : null].filter(
      (n): n is string => !!n,
    );
    return { records, catalogue, money, notes };
  }

  const isAdmin = (m: ActiveMember) => m.membership.role === 'company_admin';
  const scopesOf = (m: ActiveMember): EstimateContext['scopes'] => ({ team: m.teams.map((t) => ({ id: t.id, label: t.name })) });
  const companyLabel = (m: ActiveMember) => (isAdmin(m) ? `All teams in ${m.company.name}` : 'Your own requests');

  async function estimate(m: ActiveMember, request: UpgradeEstimateRequest, at = now()) {
    const window = resolveTimeWindow(request.timeWindow, today(m));
    const ws = await workspace(m, window.from, window.to);
    const analysis = estimateUpgrade(request, {
      catalogue: ws.catalogue,
      records: ws.records,
      scopes: scopesOf(m),
      companyLabel: companyLabel(m),
      currency: ws.money.currency,
      today: today(m),
      regionOf: () => null,
      now: at.toISOString(),
    });
    analysis.notices.push(...ws.notes);
    return analysis;
  }

  function idempotencyKey(req: Request): string | null {
    const key = req.get('Idempotency-Key');
    if (key === undefined) return null;
    if (!IDEMPOTENCY_KEY.test(key)) throw bad('Idempotency-Key must be 8 to 128 letters, digits, "-" or "_".');
    return key;
  }

  function savedId(value: unknown): string {
    if (typeof value !== 'string' || !SAVED_ID.test(value)) throw new ApiError(404, 'not_found', 'Analysis not found.');
    return value;
  }

  router.get(
    '/api/upgrade-analysis/models',
    ...member,
    perUser('upgrade-models', 30),
    run(async (_req, res): Promise<UpgradeModelsResponse> => {
      const m = getMember(res.locals);
      const to = today(m);
      const ws = await workspace(m, addDays(to, -(UPGRADE_RULES.maxWindowDays - 1)), to);
      const counts = new Map<string, number>();
      const costs = new Map<string, number>();
      for (const r of ws.records) {
        counts.set(r.modelId, (counts.get(r.modelId) ?? 0) + 1);
        costs.set(r.modelId, (costs.get(r.modelId) ?? 0) + (r.cost ?? 0));
      }
      const scopes = scopesOf(m);
      return {
        currency: ws.money.currency,
        today: to,
        currentModels: ws.catalogue
          .filter((c) => counts.has(c.id))
          .map((c) => ({ ...c, observedRequests: counts.get(c.id)!, observedCost: costs.get(c.id) ?? 0 }))
          .sort((a, b) => b.observedCost - a.observedCost || b.observedRequests - a.observedRequests),
        candidateModels: ws.catalogue.filter((c) => c.pricing),
        scopes: SCOPE_LEVELS.map((level) => ({
          level,
          label: level === 'company' ? companyLabel(m) : level[0].toUpperCase() + level.slice(1),
          options: level === 'company' ? [] : level === 'team' ? (scopes.team ?? []) : [],
        })),
        defaultRules: [],
        notes: [
          `AxiomFlo’s usage records don’t carry ${NOT_RECORDED.join(', ')} yet, so those scopes and eligibility rules can’t be used in this workspace.`,
          'No call is eligible until you confirm it with an eligibility rule; until then it shows as "requires review".',
          ...ws.notes,
        ],
      };
    }),
  );

  router.post(
    '/api/upgrade-analysis/estimate',
    ...member,
    perUser('upgrade-estimate', 30),
    run(async (req, res) => ({ analysis: await estimate(getMember(res.locals), parseEstimateRequest(req.body)) })),
  );

  router.post(
    '/api/upgrade-analysis/save',
    ...member,
    perUser('upgrade-save', 20),
    run(async (req, res): Promise<UpgradeSavedResponse> => {
      const m = getMember(res.locals);
      const key = idempotencyKey(req);
      if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) throw bad('Send { "request": { ... } }.');
      const { request, title, status, ...rest } = req.body as Record<string, unknown>;
      if (Object.keys(rest).length) throw bad('Only "request", "title" and "status" can be sent.');
      if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0 || title.length > 120)) throw bad('title must be 1 to 120 characters.');
      if (status !== undefined && status !== 'draft' && status !== 'submitted_for_review') throw bad('status must be draft or submitted_for_review.');
      const at = now();
      const analysis = await estimate(m, parseEstimateRequest(request), at);
      const { saved, replayed } = await store.save(
        companyId,
        viewerOf(m),
        {
          title: (title as string | undefined)?.trim() || `${analysis.current.displayName} → ${analysis.candidate.displayName}, ${analysis.scope.label}`,
          status: (status as 'draft' | 'submitted_for_review' | undefined) ?? 'draft',
          analysis,
          authorisation: { uid: m.membership.uid, role: m.membership.role, teamIds: [...m.membership.teamIds], readOnly: !!m.membership.readOnly },
        },
        key,
        at,
      );
      res.status(replayed ? 200 : 201);
      return { saved };
    }),
  );

  router.get(
    '/api/upgrade-analysis/:id',
    ...member,
    perUser('upgrade-read', 60),
    run(async (req, res): Promise<UpgradeSavedResponse> => {
      const saved = await store.get(companyId, viewerOf(getMember(res.locals)), savedId(req.params.id));
      if (!saved) throw new ApiError(404, 'not_found', 'Analysis not found.');
      return { saved };
    }),
  );

  router.post(
    '/api/upgrade-analysis/:id/export',
    ...member,
    perUser('upgrade-export', 20),
    run(async (req, res): Promise<UpgradeExportResponse> => {
      const m = getMember(res.locals);
      const id = savedId(req.params.id);
      const key = idempotencyKey(req);
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body !== 'object' || Array.isArray(body)) throw bad('Send { "format": "markdown" | "csv" }.');
      const { format = 'markdown', ...rest } = body;
      if (Object.keys(rest).length) throw bad('Only "format" can be sent.');
      if (format !== 'markdown' && format !== 'csv') throw bad('format must be markdown or csv.');
      const { saved, entry } = await store.recordExport(companyId, viewerOf(m), id, `Exported as ${format === 'csv' ? 'CSV' : 'Markdown'}.`, key, now());
      const content = format === 'csv' ? renderCsvReport(saved.analysis) : renderMarkdownReport(saved.analysis, { title: saved.title, savedId: saved.id, exportedAt: entry.at });
      return { id: saved.id, format, filename: `${saved.id}.${format === 'csv' ? 'csv' : 'md'}`, contentType: format === 'csv' ? 'text/csv' : 'text/markdown', content, exportedAt: entry.at };
    }),
  );

  return router;
}
