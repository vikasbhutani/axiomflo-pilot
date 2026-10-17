/**
 * Gives every request an ID, returns it in the `X-Request-Id` response header, and
 * writes one sanitized access-log line when the response finishes.
 *
 * The ID is always generated here. A client-supplied X-Request-Id is ignored so it
 * can't be used to forge or confuse log entries. Cloud Run's trace header is only
 * used to link our log lines to Cloud Run's own request log.
 */
import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from './logger.js';

export interface RequestLocals {
  requestId: string;
  /** Cloud Logging trace field, when Cloud Run supplied a trace header. */
  trace?: string;
}

const TRACE_HEADER = /^([a-f0-9]{32})(?:\/\d+)?(?:;o=[01])?$/;

export function requestContext({ logger, projectId }: { logger: Logger; projectId: string }): RequestHandler {
  return (req, res, next) => {
    const requestId = randomUUID();
    const traceMatch = TRACE_HEADER.exec(req.get('x-cloud-trace-context') ?? '');
    const trace = traceMatch ? `projects/${projectId}/traces/${traceMatch[1]}` : undefined;
    res.locals.requestId = requestId;
    res.locals.trace = trace;
    res.setHeader('X-Request-Id', requestId);

    const started = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('request', {
        requestId,
        ...(trace ? { 'logging.googleapis.com/trace': trace } : {}),
        method: req.method,
        // Path only: query strings are dropped in case anything sensitive is ever put there.
        path: req.path,
        status: res.statusCode,
        latencyMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });
    next();
  };
}
