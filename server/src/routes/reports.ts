/**
 * Report data for active members.
 *
 *   GET /api/usage?month=YYYY-MM          usage records for a reporting month
 *                                         (admins: everyone's; individual users: their own)
 *   GET /api/exchange-rates               USD to reporting-currency rates, by month
 *   PUT /api/exchange-rates/:month        Company Admin: set a month's rate `{ rate }` (audited)
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { ApiError } from '../http/errors.js';
import type { Logger } from '../http/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import { getMember, requireRole } from '../membership/requireMember.js';
import { monthBoundsUtc } from '../reports/months.js';
import type { UsageService } from '../reports/service.js';
import { parseMonth, parseRate } from '../reports/validation.js';

export function reportsRouter({ authenticate, requireMember, usage, companyId, logger }: { authenticate: RequestHandler; requireMember: RequestHandler; usage: UsageService; companyId: string; logger: Logger }): Router {
  const router = Router();
  const member = [authenticate, requireMember];
  const writeLimit = rateLimit({ name: 'rate-write', limit: 30, windowMs: 60_000, key: (locals) => getMember(locals).membership.uid });

  const run = (work: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await work(req, res));
    } catch (error) {
      if (error instanceof ApiError) return next(error);
      logger.error('report query failed', { requestId: res.locals.requestId, errorName: (error as Error)?.name, code: (error as { code?: unknown })?.code });
      return next(new ApiError(503, 'membership_unavailable', 'We couldn’t load this report just now. Please try again.'));
    }
  };

  router.get(
    '/api/usage',
    ...member,
    run(async (req, res) => {
      const { company, membership } = getMember(res.locals);
      const month = parseMonth(req.query.month);
      const [startIso, endIso] = monthBoundsUtc(month, company.reportingTimezone);
      const result = await usage.listUsage(companyId, { uid: membership.uid, role: membership.role }, { startIso, endIso });
      return { month, startIso, endIso, ...result };
    }),
  );

  router.get('/api/exchange-rates', ...member, run(async (_req, res) => ({ currency: getMember(res.locals).company.reportingCurrency, rates: await usage.listRates(companyId) })));

  router.put(
    '/api/exchange-rates/:month',
    ...member,
    requireRole('company_admin'),
    writeLimit,
    run(async (req, res) => {
      const { company, membership } = getMember(res.locals);
      const month = parseMonth(req.params.month);
      const rate = parseRate(req.body);
      return { rate: await usage.setRate(companyId, membership.uid, month, rate, company.reportingCurrency) };
    }),
  );

  return router;
}
