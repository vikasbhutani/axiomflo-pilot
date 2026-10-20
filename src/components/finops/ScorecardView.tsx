/**
 * The FinOps Scorecard body, shared by the demo and real workspaces. It only
 * displays a Scorecard built by src/lib/finops.ts; it calculates nothing itself.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Bot, ChevronDown, ChevronUp, Gauge, Users } from 'lucide-react';
import { Card, CardHeader } from '../ui/Card';
import { StatCard } from '../ui/StatCard';
import { TableScroll } from '../ui/TableScroll';
import { InfoTooltip } from '../ui/InfoTooltip';
import { CountUp } from '../ui/CountUp';
import { safeRatio } from '../../lib/calculations';
import { formatCompact, formatNumber, formatPercent } from '../../lib/format';
import type { Lever, Scorecard, UnitEconomics } from '../../lib/finops';

export interface ScorecardViewProps {
  scorecard: Scorecard;
  money: (value: number | null, options?: { precise?: boolean }) => string;
  /** E.g. "August 2026", for the comparison line. */
  previousLabel: string | null;
  /** Where the assistant lives, for the "ask about this" link. */
  assistantHref?: string;
}

const GRADE_STYLE: Record<NonNullable<Scorecard['grade']>, string> = {
  A: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  B: 'bg-teal-100 text-teal-800 ring-teal-200',
  C: 'bg-sky-100 text-sky-800 ring-sky-200',
  D: 'bg-amber-100 text-amber-800 ring-amber-200',
  E: 'bg-red-100 text-red-800 ring-red-200',
};

const EFFORT_STYLE: Record<Lever['effort'], string> = {
  Low: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  Medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  High: 'bg-red-50 text-red-700 ring-red-200',
};

export const SCORE_HELP =
  'Out of 100. Savings headroom (40 points) falls as the five levers’ combined savings approach 75% of spend. Model fit (20) falls as the spend on short jobs sent to higher-tier models approaches 30%. Failed-request waste (20) falls as spend on failed requests approaches 5%. Cost visibility (20) falls as the share of requests with a known cost drops from 100% to 80%.';

export function ScorecardView({ scorecard, money, previousLabel, assistantHref }: ScorecardViewProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <ScoreCard scorecard={scorecard} money={money} />
        <div className="lg:col-span-2">
          <EconomicsGrid economics={scorecard.economics} previous={scorecard.previousEconomics} previousLabel={previousLabel} money={money} />
        </div>
      </div>
      <LeverComparison scorecard={scorecard} money={money} assistantHref={assistantHref} />
      <WorkflowTable scorecard={scorecard} money={money} />
    </div>
  );
}

function ScoreCard({ scorecard, money }: { scorecard: Scorecard; money: ScorecardViewProps['money'] }) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            FinOps score <InfoTooltip text={SCORE_HELP} label="How the score works" />
          </span>
        }
        description="How efficiently this period’s AI spend was used"
      />
      <div className="px-5 py-5">
        <div className="flex items-center gap-4">
          <p className="text-5xl font-semibold tabular-nums tracking-tight text-slate-900" aria-label={`Score ${scorecard.score ?? 'not available'} out of 100`}>
            {scorecard.score === null ? '—' : <CountUp value={scorecard.score} format={(n) => Math.round(n).toString()} duration={1500} />}
            <span className="text-lg font-normal text-slate-400">/100</span>
          </p>
          {scorecard.grade && <span className={`rounded-lg px-3 py-1.5 text-2xl font-bold ring-1 ${GRADE_STYLE[scorecard.grade]}`}>{scorecard.grade}</span>}
        </div>
        <p className="mt-3 text-sm text-slate-600">
          Up to <strong className="font-semibold text-slate-900">{money(scorecard.combinedSavings)}</strong> ({formatPercent(scorecard.combinedSavingsShare)}) could be saved if all five levers were pulled, allowing for overlap.
        </p>
        <ul className="mt-5 space-y-3">
          {scorecard.components.map((c) => (
            <li key={c.id}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-slate-700">{c.label}</span>
                <span className="tabular-nums text-slate-500">
                  {c.points.toFixed(0)} / {c.max}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100" aria-hidden>
                <div className="h-1.5 origin-left animate-grow-x rounded-full bg-teal-600 transition-[width] duration-500" style={{ width: `${(c.points / c.max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function Change({ now, before, previousLabel, lowerIsBetter = true }: { now: number | null; before: number | null | undefined; previousLabel: string | null; lowerIsBetter?: boolean }) {
  if (now === null || before === null || before === undefined || before === 0 || !previousLabel) return null;
  const change = (now - before) / before;
  const good = lowerIsBetter ? change <= 0 : change >= 0;
  const Icon = change >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    // Keyed on the change so the badge pops in again when the month changes it.
    <span key={change.toFixed(4)} className={`inline-flex origin-left animate-pop items-center gap-0.5 ${good ? 'text-emerald-700' : 'text-amber-700'}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {formatPercent(Math.abs(change))} vs {previousLabel}
    </span>
  );
}

function EconomicsGrid({ economics: e, previous: p, previousLabel, money }: { economics: UnitEconomics; previous: UnitEconomics | null; previousLabel: string | null; money: ScorecardViewProps['money'] }) {
  return (
    <section aria-labelledby="unit-economics" className="h-full">
      <h2 id="unit-economics" className="sr-only">
        Unit economics
      </h2>
      <div className="stagger grid h-full gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Estimated spend" value={money(e.spend)} detail={<Change now={e.spend} before={p?.spend} previousLabel={previousLabel} />} />
        <StatCard
          label="Cost per request"
          tooltip="Spend divided by requests with a known cost."
          value={money(e.costPerRequest, { precise: true })}
          detail={<Change now={e.costPerRequest} before={p?.costPerRequest} previousLabel={previousLabel} />}
        />
        <StatCard
          label="Cost per successful request"
          tooltip="Spend, including what failed requests cost, divided by requests that succeeded: what each useful answer really cost."
          value={money(e.costPerSuccessfulRequest, { precise: true })}
          detail={`${formatNumber(e.succeededCostedRequests)} successful requests`}
        />
        <StatCard
          label="Cost per million tokens"
          tooltip="Spend divided by input and output tokens, per million."
          value={money(e.costPerMillionTokens)}
          detail={`${formatCompact(e.inputTokens)} in · ${formatCompact(e.outputTokens)} out`}
        />
        <StatCard label="Cost per active person" icon={<Users className="h-4 w-4" />} value={money(e.costPerActivePerson)} detail={`${formatNumber(e.activePeople)} ${e.activePeople === 1 ? 'person' : 'people'} sent requests`} />
        <StatCard
          label="Spend on failed requests"
          tone={(e.failedSpendShare ?? 0) > 0.05 ? 'warning' : 'default'}
          value={money(e.failedSpend)}
          detail={e.unresolvedRequests > 0 ? `${formatPercent(e.failedSpendShare, 1)} of spend · ${formatNumber(e.unresolvedRequests)} without a cost` : `${formatPercent(e.failedSpendShare, 1)} of spend`}
        />
      </div>
    </section>
  );
}

function LeverComparison({ scorecard, money, assistantHref }: { scorecard: Scorecard; money: ScorecardViewProps['money']; assistantHref?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(0, ...scorecard.levers.map((l) => l.savings));
  return (
    <Card>
      <CardHeader
        title="Five optimisation levers, by savings potential"
        description="Each lever is estimated on its own, so the amounts overlap and don’t add up to the combined figure."
        action={
          assistantHref && (
            <Link to={assistantHref} className="btn-secondary">
              <Bot className="h-4 w-4" aria-hidden /> Ask the assistant
            </Link>
          )
        }
      />
      <ol className="divide-y divide-slate-100">
        {scorecard.levers.map((l) => {
          const expanded = open === l.id;
          return (
            <li key={l.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{l.rank}</span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                      {l.name}
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${EFFORT_STYLE[l.effort]}`}>{l.effort} effort</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">{l.summary}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums text-slate-900">{money(l.savings)}</p>
                  <p className="text-xs tabular-nums text-slate-500">{l.savingsShare === null ? '—' : `${formatPercent(l.savingsShare, 1)} of spend`}</p>
                </div>
              </div>
              <div className="ml-9 mt-2 h-2 rounded-full bg-slate-100" aria-hidden>
                <div className="h-2 origin-left animate-grow-x rounded-full bg-teal-600 transition-[width] duration-500" style={{ width: `${max > 0 ? (l.savings / max) * 100 : 0}%` }} />
              </div>
              <div className="ml-9 mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {formatNumber(l.affectedRequests)} request{l.affectedRequests === 1 ? '' : 's'} · {money(l.affectedSpend)} in scope
                </span>
                <button type="button" className="inline-flex items-center gap-1 font-medium text-teal-800 hover:underline" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : l.id)}>
                  {expanded ? 'Hide details' : 'How it’s worked out'}
                  {expanded ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
                </button>
              </div>
              {expanded && (
                <div className="ml-9 mt-3 space-y-2 rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-700">
                  <p>
                    <strong className="font-semibold">What to do:</strong> {l.action}
                  </p>
                  <p>
                    <strong className="font-semibold">Assumption:</strong> {l.assumption}
                  </p>
                  {l.moves && l.moves.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {l.moves.map((m) => (
                        <li key={`${m.fromModelId}>${m.toModelId}`}>
                          {m.fromModel} → {m.toModel ?? 'a smaller model'}: {formatNumber(m.requests)} requests, {money(m.savings)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function WorkflowTable({ scorecard, money }: { scorecard: Scorecard; money: ScorecardViewProps['money'] }) {
  const total = scorecard.economics.spend;
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            Token cost per workflow <Gauge className="h-4 w-4 text-slate-400" aria-hidden />
          </span>
        }
        description={
          scorecard.exactSplit
            ? 'Each application is its own workflow; people’s own use is grouped by team. Input and output costs use the price list.'
            : 'Each application is its own workflow; people’s own use is grouped by team. Input and output costs are split assuming output tokens cost five times input tokens.'
        }
      />
      <TableScroll label="Token cost per workflow">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="whitespace-nowrap bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-2.5 font-medium">Workflow</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Requests</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Input tokens</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Output tokens</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Input cost</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Output cost</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Per request</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Per 1M tokens</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Spend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 tabular-nums">
            {scorecard.workflows.map((w) => (
              <tr key={w.id}>
                <th scope="row" className="px-5 py-3 text-left font-medium text-slate-900">
                  {w.label}
                  <span className="block text-xs font-normal text-slate-500">{w.kind === 'automated' ? 'Automated' : 'Interactive'}</span>
                </th>
                <td className="px-3 py-3 text-right text-slate-700">{formatNumber(w.requests)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatCompact(w.inputTokens)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatCompact(w.outputTokens)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{money(w.inputSpend)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{money(w.outputSpend)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{money(w.costPerRequest, { precise: true })}</td>
                <td className="px-3 py-3 text-right text-slate-700">{money(w.costPerMillionTokens)}</td>
                <td className="px-5 py-3 text-right">
                  <span className="font-semibold text-slate-900">{money(w.spend)}</span>
                  <span className="block text-xs text-slate-500">{formatPercent(safeRatio(w.spend, total))}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}
