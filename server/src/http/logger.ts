/**
 * Structured JSON logs, one line per entry, in the shape Cloud Logging understands
 * (`severity`, `message`, and the trace field for request correlation).
 *
 * Logs must never contain tokens, Authorization headers or credential objects. Callers
 * pass only the fields they choose, and `sanitize` removes any key that looks
 * sensitive as a second line of defence. Request bodies and headers are never logged.
 */
import type { LogLevel } from '../config.js';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY: Record<LogLevel, string> = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };
const SENSITIVE_KEY = /authorization|token|cookie|password|secret|credential|private.?key|api.?key/i;
const MAX_DEPTH = 4;

export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitize(v, depth + 1);
  }
  return out;
}

export function createLogger({ level, write = (line) => process.stdout.write(line + '\n') }: { level: LogLevel; write?: (line: string) => void }): Logger {
  const log = (entryLevel: LogLevel, message: string, fields: LogFields = {}) => {
    if (ORDER[entryLevel] < ORDER[level]) return;
    write(JSON.stringify({ severity: SEVERITY[entryLevel], message, time: new Date().toISOString(), ...(sanitize(fields) as LogFields) }));
  };
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  };
}

/** A logger that discards everything, for tests. */
export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
