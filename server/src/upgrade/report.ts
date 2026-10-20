/**
 * Exportable Upgrade Analysis reports (Markdown and CSV), in the assistant's response
 * format. Pure, so the demo workspace exports exactly what the API does.
 */
import { count, money, pct, signedMoney, signedPct } from './format.js';
import type { ModelSide, UpgradeAnalysis } from './types.js';

export interface ReportMeta {
  title?: string;
  savedId?: string;
  savedBy?: string;
  exportedAt?: string;
}

function modelLine(m: ModelSide): string {
  return `${m.providerName} / ${m.displayName} / ${m.version}`;
}

/** The response format from the assistant, as plain lines (Markdown bold for headings). */
export function summaryLines(a: UpgradeAnalysis): string[] {
  const c = a.currency;
  const f = a.financial;
  const e = a.eligibility;
  const impact = (id: string) => a.impacts.find((i) => i.id === id);
  const impactText = (id: string) => {
    const i = impact(id);
    return i ? `${signedMoney(i.amount, c)} / ${signedPct(i.pctOfMigrated)}` : 'Not available';
  };
  const lines = [
    '**Upgrade Analysis**',
    '',
    `**Scope:** ${a.scope.label}`,
    `**Period:** ${a.period.label}`,
    `**Current model:** ${modelLine(a.current)}`,
    `**Candidate model:** ${modelLine(a.candidate)}`,
    `**Migration assumption:** ${a.migrationPercentage}% of eligible calls`,
    '',
    '**Financial impact** (modelled projection, not a guaranteed saving)',
  ];
  if (f) {
    lines.push(
      `- Current estimated cost: ${money(f.currentCost, c)} (based on observed usage)`,
      `- Projected cost: ${money(f.projectedCost, c)}`,
      `- Estimated monthly saving: ${money(f.monthlySavings, c)}`,
      `- Estimated annualised saving: ${money(f.annualisedSavings, c)} (extrapolation)`,
      `- Estimated reduction: ${f.savingsPct === null ? 'Not available' : pct(f.savingsPct / 100)}`,
    );
    if (f.oneOffMigrationCost !== null) lines.push(`- One-off migration cost (separate): ${money(f.oneOffMigrationCost, c)}${f.paybackMonths !== null ? `, paid back in about ${f.paybackMonths.toFixed(1)} months` : ''}`);
  } else {
    lines.push(`- ${a.recommendation.reasons[0] ?? 'Cost can’t be calculated.'}`, `- Current calls: ${count(a.current.usage.requests)}`);
  }
  lines.push(
    '',
    '**What changed**',
    `- Input-token impact: ${impactText('input_tokens')}`,
    `- Output-token impact: ${impactText('output_tokens')}`,
    `- Request-volume impact: ${impactText('request_volume')}`,
    `- Retry or fallback impact: ${impactText('retries')}`,
    `- Unit-price impact: ${impactText('unit_price')}`,
    '',
    '**Eligibility**',
    `- Eligible calls: ${count(e.eligible.requests)} / ${pct(e.eligible.share)}`,
    `- Ineligible calls: ${count(e.ineligible.requests)} / ${pct(e.ineligible.share)}`,
    `- Requires review: ${count(e.requiresReview.requests)} / ${pct(e.requiresReview.share)}`,
    '',
    '**Risks**',
    ...a.risks.map((r) => `- ${r.label} (${r.level}): ${r.detail}`),
    '',
    `**Recommendation:** ${a.recommendation.label}`,
    ...a.recommendation.reasons.map((r) => `- ${r}`),
    '',
    `**Suggested next step:** ${a.nextStep}`,
  );
  if (a.rolloutPlan) lines.push('', '**Suggested rollout plan** (proposal only; nothing changes without explicit approval)', ...a.rolloutPlan.map((s, i) => `${i + 1}. ${s}`));
  lines.push('', a.disclaimer);
  return lines;
}

export function renderMarkdownReport(a: UpgradeAnalysis, meta: ReportMeta = {}): string {
  const c = a.currency;
  const out = [`# ${meta.title ?? `Upgrade Analysis: ${a.current.displayName} → ${a.candidate.displayName}`}`, ''];
  out.push(`_Estimated savings · Modelled projection · Not a guaranteed saving._`, '');
  const meta2 = [
    `Calculated: ${a.calculatedAt}`,
    `Currency: ${c}`,
    `Pricing: current ${a.current.pricing?.pricingVersion ?? 'not on record'} (${a.current.pricing?.pricingSource ?? 'no source'}); candidate ${a.candidate.pricing?.pricingVersion ?? 'not on record'} (${a.candidate.pricing?.pricingSource ?? 'no source'})`,
    `Basis: current cost ${a.basis.current}, usage ${a.basis.usage}, projection ${a.basis.projection}`,
  ];
  if (meta.savedId) meta2.push(`Saved analysis: ${meta.savedId}${meta.savedBy ? ` by ${meta.savedBy}` : ''}`);
  if (meta.exportedAt) meta2.push(`Exported: ${meta.exportedAt}`);
  out.push(...meta2.map((l) => `- ${l}`), '');
  out.push(...summaryLines(a), '');
  if (a.breakdown.length) {
    out.push('## Cost breakdown', '', '| Item | Current | Projected | Current cost | Projected cost | Note |', '| --- | ---: | ---: | ---: | ---: | --- |');
    for (const r of a.breakdown) out.push(`| ${r.label} | ${count(r.currentQuantity)} | ${count(r.projectedQuantity)} | ${money(r.currentCost, c)} | ${money(r.projectedCost, c)} | ${r.note ?? ''} |`);
    out.push('');
  }
  if (a.eligibility.reasons.length) {
    out.push('## Why calls are ineligible or need review', '');
    for (const r of a.eligibility.reasons) out.push(`- ${r.status === 'ineligible' ? 'Ineligible' : 'Requires review'}: ${r.reason} (${count(r.requests)})`);
    out.push('');
  }
  out.push('## Assumptions and calculation basis', '', ...a.calculationBasis.map((l) => `- ${l}`));
  const assumptions = Object.entries(a.inputs.assumptions);
  if (assumptions.length) out.push(...assumptions.map(([k, v]) => `- Assumption \`${k}\`: ${v}`));
  if (a.inputs.eligibilityRules.length) out.push(...a.inputs.eligibilityRules.map((r) => `- Eligibility rule: ${r.level}${r.targetId ? ` ${r.targetId}` : ''} → ${r.decision}${r.reason ? ` (${r.reason})` : ''}`));
  if (a.notices.length) out.push('', '## Notes', '', ...a.notices.map((n) => `- ${n}`));
  return out.join('\n') + '\n';
}

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  // Leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) && typeof value === 'string' ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function renderCsvReport(a: UpgradeAnalysis): string {
  const rows: (string | number | null)[][] = [
    ['field', 'value'],
    ['label', 'Modelled projection - not a guaranteed saving'],
    ['scope', a.scope.label],
    ['period_from', a.period.from],
    ['period_to', a.period.to],
    ['currency', a.currency],
    ['current_model', a.current.modelId],
    ['current_pricing_version', a.current.pricing?.pricingVersion ?? null],
    ['candidate_model', a.candidate.modelId],
    ['candidate_pricing_version', a.candidate.pricing?.pricingVersion ?? null],
    ['migration_percentage', a.migrationPercentage],
    ['current_estimated_cost', a.financial?.currentCost ?? null],
    ['projected_cost', a.financial?.projectedCost ?? null],
    ['estimated_savings', a.financial?.savings ?? null],
    ['estimated_monthly_savings', a.financial?.monthlySavings ?? null],
    ['estimated_annualised_savings', a.financial?.annualisedSavings ?? null],
    ['estimated_reduction_pct', a.financial?.savingsPct ?? null],
    ['eligible_calls', a.eligibility.eligible.requests],
    ['ineligible_calls', a.eligibility.ineligible.requests],
    ['requires_review_calls', a.eligibility.requiresReview.requests],
    ['recommendation', a.recommendation.label],
    ['calculated_at', a.calculatedAt],
    ['disclaimer', a.disclaimer],
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
