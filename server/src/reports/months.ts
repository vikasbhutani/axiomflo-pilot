/**
 * Reporting months are calendar months in the company's reporting timezone
 * (Australia/Sydney for the pilot). Usage timestamps are stored in UTC, so a month
 * is turned into the exact UTC instants where it starts and ends.
 */
export const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Minutes the zone is ahead of UTC at a given instant. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

/** The UTC instant of local midnight on the first day of a month. */
function monthStartUtc(year: number, month: number, timeZone: string): number {
  const guess = Date.UTC(year, month - 1, 1);
  let t = guess - offsetMinutes(guess, timeZone) * 60_000;
  // Once more, in case the guess landed on the other side of a daylight-saving change.
  t = guess - offsetMinutes(t, timeZone) * 60_000;
  return t;
}

/** [start, end) of a reporting month as UTC ISO strings. */
export function monthBoundsUtc(month: string, timeZone: string): [string, string] {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`Not a month: ${month}`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  const next = mon === 12 ? [year + 1, 1] : [year, mon + 1];
  return [new Date(monthStartUtc(year, mon, timeZone)).toISOString(), new Date(monthStartUtc(next[0], next[1], timeZone)).toISOString()];
}

/** The current reporting month (YYYY-MM) in a timezone. */
export function currentMonth(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
}

/** `month` and the `count - 1` months before it, oldest first. */
export function monthsEndingWith(month: string, count: number): string[] {
  const m = MONTH.exec(month);
  if (!m) throw new Error(`Not a month: ${month}`);
  let year = Number(m[1]);
  let mon = Number(m[2]);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${year}-${String(mon).padStart(2, '0')}`);
    mon--;
    if (mon === 0) {
      mon = 12;
      year--;
    }
  }
  return out;
}
