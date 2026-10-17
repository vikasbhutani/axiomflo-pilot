/** The fields of stored records that clients may see. Anything not listed here stays on the server. */
import type { CompanyRecord, TeamRecord } from '../membership/records.js';

export function companyView(c: CompanyRecord) {
  return { id: c.id, name: c.name, reportingCurrency: c.reportingCurrency, reportingTimezone: c.reportingTimezone };
}

export function teamView(t: TeamRecord) {
  return { id: t.id, name: t.name, code: t.code, departmentId: t.departmentId, status: t.status };
}
