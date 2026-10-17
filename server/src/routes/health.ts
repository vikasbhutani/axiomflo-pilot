import { Router } from 'express';

/** Liveness check for Cloud Run and uptime monitors. Reveals no configuration or versions. */
export function healthRouter(): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  return router;
}
