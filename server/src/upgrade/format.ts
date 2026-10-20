/** Display helpers for Upgrade Analysis text (calculation basis, reports). Pure; no Node or browser APIs beyond Intl. */

const moneyFormats = new Map<string, Intl.NumberFormat>();

export function money(value: number | null | undefined, currency: string, precise = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Not available';
  const digits = precise ? 4 : 2;
  const key = `${currency}:${digits}`;
  let format = moneyFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat('en-AU', { style: 'currency', currency, currencyDisplay: currency === 'AUD' ? 'symbol' : 'code', minimumFractionDigits: digits, maximumFractionDigits: digits });
    moneyFormats.set(key, format);
  }
  return format.format(value);
}

/** "+$1.20" / "−$1.20" */
export function signedMoney(value: number, currency: string): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${money(Math.abs(value), currency)}`;
}

const integer = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });

export function count(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? 'Not available' : integer.format(value);
}

/** 0.123 → "12.3%" */
export function pct(fraction: number | null | undefined, digits = 1): string {
  return fraction === null || fraction === undefined || !Number.isFinite(fraction) ? 'Not available' : `${(fraction * 100).toFixed(digits)}%`;
}

export function signedPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return 'Not available';
  return `${fraction > 0 ? '+' : fraction < 0 ? '−' : ''}${Math.abs(fraction * 100).toFixed(digits)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}
