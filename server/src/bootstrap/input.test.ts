import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BootstrapInputError, parseAdminUid, parseBootstrapInput } from './input.js';

const valid = {
  company: { id: 'pilot-co', name: 'Pilot Co', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' },
  department: { id: 'engineering', name: 'Engineering' },
  teams: [
    { id: 'platform', name: 'Platform', code: 'PLAT' },
    { id: 'product', name: 'Product', code: 'PROD' },
  ],
};

describe('parseBootstrapInput', () => {
  it('accepts a complete configuration', () => {
    expect(parseBootstrapInput(valid).teams.map((t) => t.code)).toEqual(['PLAT', 'PROD']);
  });

  it('refuses the unedited example file, so placeholders never reach production', () => {
    const example = JSON.parse(readFileSync(new URL('../../bootstrap.example.json', import.meta.url), 'utf8'));
    expect(() => parseBootstrapInput(example)).toThrow(/placeholder/);
  });

  it.each([
    ['one team', { ...valid, teams: [valid.teams[0]] }],
    ['duplicate team codes', { ...valid, teams: [valid.teams[0], { ...valid.teams[1], code: 'PLAT' }] }],
    ['duplicate team ids', { ...valid, teams: [valid.teams[0], { ...valid.teams[1], id: 'platform' }] }],
    ['a company id with a slash', { ...valid, company: { ...valid.company, id: 'a/b' } }],
    ['a lower-case team code', { ...valid, teams: [{ ...valid.teams[0], code: 'plat' }, valid.teams[1]] }],
    ['an unknown time zone', { ...valid, company: { ...valid.company, reportingTimezone: 'Mars/Base' } }],
    ['a bad currency', { ...valid, company: { ...valid.company, reportingCurrency: 'dollars' } }],
  ])('refuses %s', (_label, input) => {
    expect(() => parseBootstrapInput(input)).toThrow(BootstrapInputError);
  });
});

describe('parseAdminUid', () => {
  it('accepts a Firebase UID and refuses empty or placeholder values', () => {
    expect(parseAdminUid(' AbC123xyz ')).toBe('AbC123xyz');
    expect(() => parseAdminUid(undefined)).toThrow(BootstrapInputError);
    expect(() => parseAdminUid('REPLACE-ME')).toThrow(BootstrapInputError);
    expect(() => parseAdminUid('has spaces in it')).toThrow(BootstrapInputError);
  });
});
