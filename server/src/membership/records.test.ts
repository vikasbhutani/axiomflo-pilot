import { describe, expect, it } from 'vitest';
import { InvalidRecordError, parseCompany, parseMembership, parseTeam } from './records.js';

describe('parseMembership', () => {
  const good = { uid: 'u1', role: 'individual_user', teamIds: ['t1', 't1', 't2'], status: 'active', createdAt: {} };

  it('reads a valid membership and removes duplicate team IDs', () => {
    expect(parseMembership('c', 'u1', good)).toEqual({ uid: 'u1', role: 'individual_user', teamIds: ['t1', 't2'], status: 'active' });
  });

  it.each([
    ['an unknown role', { ...good, role: 'owner' }],
    ['a missing role', { ...good, role: undefined }],
    ['a "pending" status (pending is never stored)', { ...good, status: 'pending' }],
    ['teamIds that is not a list', { ...good, teamIds: 't1' }],
    ['a non-string team ID', { ...good, teamIds: [1] }],
    ['a uid field that differs from the document ID', { ...good, uid: 'someone-else' }],
  ])('refuses %s', (_label, data) => {
    expect(() => parseMembership('c', 'u1', data)).toThrow(InvalidRecordError);
  });
});

describe('parseCompany and parseTeam', () => {
  it('read valid records', () => {
    expect(parseCompany('c', { name: 'Co', status: 'active', reportingCurrency: 'AUD', reportingTimezone: 'Australia/Sydney' }).status).toBe('active');
    expect(parseTeam('c', 't', { departmentId: 'd', name: 'T', code: 'T-1', status: 'active' }).code).toBe('T-1');
  });

  it('refuse unknown statuses and missing names', () => {
    expect(() => parseCompany('c', { name: 'Co', status: 'trial', reportingCurrency: 'AUD', reportingTimezone: 'UTC' })).toThrow(InvalidRecordError);
    expect(() => parseTeam('c', 't', { departmentId: 'd', name: '', code: 'T', status: 'active' })).toThrow(InvalidRecordError);
  });
});
