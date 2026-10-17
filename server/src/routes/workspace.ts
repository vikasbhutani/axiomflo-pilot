/**
 * Workspace routes for active members of the pilot company.
 *
 *   GET /api/company  basic company details
 *   GET /api/teams    admins: every team; individual users: their assigned teams only
 */
import { Router, type RequestHandler } from 'express';
import { getMember } from '../membership/requireMember.js';
import { companyView, teamView } from './views.js';

export function workspaceRouter({ authenticate, requireMember }: { authenticate: RequestHandler; requireMember: RequestHandler }): Router {
  const router = Router();
  router.get('/api/company', authenticate, requireMember, (_req, res) => {
    res.json({ company: companyView(getMember(res.locals).company) });
  });
  router.get('/api/teams', authenticate, requireMember, (_req, res) => {
    res.json({ teams: getMember(res.locals).teams.map(teamView) });
  });
  return router;
}
