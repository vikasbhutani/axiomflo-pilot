/**
 * Display formatting. Calculations keep full precision; rounding happens only here.
 */

export const REPORTING_TIMEZONE = 'Australia/Sydney';
export const REPORTING_CURRENCY = 'AUD';

const currency2 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: REPORTING_CURRENCY, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const currency4 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: REPORTING_CURRENCY, minimumFractionDigits: 4, maximumFractionDigits: 4 });
const integer = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 });

export const NOT_AVAILABLE = 'Not available';

/** AUD with 2 decimals (totals). Pass `precise` for per-request amounts (4 decimals). */
export function formatCurrency(value: number | null | undefined, options: { precise?: boolean } = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_AVAILABLE;
  return (options.precise ? currency4 : currency2).format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return NOT_AVAILABLE;
  return integer.format(value);
}

export function formatCompact(value: number): string {
  return compact.format(value);
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return NOT_AVAILABLE;
  return `${(value * 100).toFixed(digits)}%`;
}

const localDateParts = new Intl.DateTimeFormat('en-CA', { timeZone: REPORTING_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Australia/Sydney calendar date (YYYY-MM-DD) for an ISO timestamp. */
export function toLocalDate(isoTimestamp: string): string {
  return localDateParts.format(new Date(isoTimestamp));
}

const dateTime = new Intl.DateTimeFormat('en-AU', { timeZone: REPORTING_TIMEZONE, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const shortDateTime = new Intl.DateTimeFormat('en-AU', { timeZone: REPORTING_TIMEZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

export function formatDateTime(isoTimestamp: string | null, options: { short?: boolean } = {}): string {
  if (!isoTimestamp) return NOT_AVAILABLE;
  return (options.short ? shortDateTime : dateTime).format(new Date(isoTimestamp));
}

/** Formats a calendar date string (YYYY-MM-DD) without timezone shifting. */
export function formatCalendarDate(date: string, options: { withYear?: boolean } = {}): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(options.withYear ? { year: 'numeric' } : {}) }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "September 2026" for a period key such as "2026-09". */
export function formatPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** First and last calendar dates of a period, e.g. ["2026-09-01", "2026-09-30"]. */
export function periodBounds(period: string): [string, string] {
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${period}-01`, `${period}-${String(lastDay).padStart(2, '0')}`];
}

export function formatPeriodRange(period: string): string {
  const [start, end] = periodBounds(period);
  return `${formatCalendarDate(start)} – ${formatCalendarDate(end, { withYear: true })}`;
}
