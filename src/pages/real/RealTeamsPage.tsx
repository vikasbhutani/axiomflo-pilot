/** Teams for a real workspace: each team's spend in the month, and who it came from. */
import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/layout/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/States';
import { TableScroll } from '../../components/ui/TableScroll';
import { summarize, summarizeBy } from '../../lib/calculations';
import { formatNumber, formatPeriod } from '../../lib/format';
import { useMonthParam, useRealDataset, useRealMember } from '../../reports/useRealReport';
import { COST_NOTE, DataNotes, MonthSelect, spendText } from './RealParts';

export function RealTeamsPage() {
  const [month, setMonth, months] = useMonthParam();
  const { isAdmin, teams } = useRealMember();
  const state = useRealDataset(month);

  return (
    <>
      <PageHeader
        title="Teams & Users"
        description={isAdmin ? `Spend per team and per person in ${formatPeriod(month)}.` : `Your teams, and your own requests in ${formatPeriod(month)}.`}
        actions={<MonthSelect month={month} months={months} onChange={setMonth} />}
      />
      {isAdmin && (
        <p className="mb-4 text-sm text-slate-600">
          To invite people or change roles and teams, go to{' '}
          <Link to="/settings?tab=members" className="font-medium text-teal-800 underline">
            Settings
          </Link>
          .
        </p>
      )}
      {state.status === 'error' ? (
        <Card>
          <ErrorState message={state.error.message} onRetry={state.reload} />
        </Card>
      ) : !state.data ? (
        <Card>
          <LoadingState label="Loading teams…" />
        </Card>
      ) : (
        <div className="space-y-6">
          <DataNotes data={state.data} isAdmin={isAdmin} />
          {teams.length === 0 && (
            <Card>
              <EmptyState title="No teams assigned yet" description="Ask your Company Admin to add you to a team." />
            </Card>
          )}
          {/* Teams that no longer appear in the list (e.g. one you've left) still show if they have requests. */}
          {[
            ...teams.map((t) => ({ id: t.id, name: t.name, code: t.code })),
            ...extraTeams(
              state.data.records,
              teams.map((t) => t.id),
            ),
          ].map((team) => {
            const records = state.data!.records.filter((r) => r.teamId === team.id);
            const s = summarize(records);
            const people = [...summarizeBy(records, (r) => r.principal.id).entries()]
              .map(([uid, summary]) => ({ uid, summary, record: records.find((r) => r.principal.id === uid)! }))
              .sort((a, b) => b.summary.estimatedSpend - a.summary.estimatedSpend);
            const currency = state.data!.money.currency;
            return (
              <Card key={team.id}>
                <CardHeader
                  title={
                    <>
                      {team.name} <span className="font-mono text-xs font-normal text-slate-500">{team.code}</span>
                    </>
                  }
                  description={`${formatNumber(s.requestCount)} request${s.requestCount === 1 ? '' : 's'} · ${s.requestCount === 0 ? 'no spend' : `${spendText(s, currency)} estimated`}`}
                />
                {people.length === 0 ? (
                  <EmptyState title={isAdmin ? 'No requests from this team this month' : 'You made no requests for this team this month'} />
                ) : (
                  <TableScroll label={`${team.name} people`}>
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                          <th scope="col" className="px-5 py-2 font-medium">
                            Person
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            Requests
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            Tokens (in / out)
                          </th>
                          <th scope="col" className="px-5 py-2 text-right font-medium">
                            Estimated spend
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {people.map(({ uid, summary, record }) => (
                          <tr key={uid}>
                            <td className="px-5 py-2.5">
                              <p className="text-slate-900">{record.principalName}</p>
                              {record.principalEmail && record.principalEmail !== record.principalName && <p className="text-xs text-slate-500">{record.principalEmail}</p>}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(summary.requestCount)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                              {formatNumber(summary.inputTokens)} / {formatNumber(summary.outputTokens)}
                            </td>
                            <td className="px-5 py-2.5 text-right tabular-nums text-slate-900">{spendText(summary, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableScroll>
                )}
              </Card>
            );
          })}
          <p className="text-xs text-slate-500">Requests count towards the team their AxiomFlo key belongs to, as it was when the request was made. {COST_NOTE}</p>
        </div>
      )}
    </>
  );
}

function extraTeams(records: { teamId: string; teamName: string; teamCode: string }[], known: string[]) {
  const extra = new Map<string, { id: string; name: string; code: string }>();
  for (const r of records) if (!known.includes(r.teamId)) extra.set(r.teamId, { id: r.teamId, name: r.teamName, code: r.teamCode });
  return [...extra.values()];
}
