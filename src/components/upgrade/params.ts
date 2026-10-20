import { SCOPE_LEVELS, type ScopeLevel, type UpgradeEstimateRequest } from '../../lib/upgrade';
import type { UpgradeAnalysisViewProps } from './UpgradeAnalysisView';

/**
 * Choices handed over in the link, e.g. from the assistant chat:
 * /assistant/upgrade?current=…&candidate=…&scope=team:team-a&window=last_7_days&pct=80
 * (or window=custom&from=…&to=…). Anything unknown is ignored; the API checks it all again.
 */
export function parseUpgradeParams(params: URLSearchParams): UpgradeAnalysisViewProps['initial'] {
  const out: NonNullable<UpgradeAnalysisViewProps['initial']> = {};
  const current = params.get('current');
  const candidate = params.get('candidate');
  if (current) out.currentModelId = current;
  if (candidate) out.candidateModelId = candidate;
  const scope = params.get('scope');
  if (scope) {
    const [level, id] = scope.split(':');
    if (SCOPE_LEVELS.includes(level as ScopeLevel)) out.scope = { level: level as ScopeLevel, id: level === 'company' ? null : (id ?? null) };
  }
  const window = params.get('window');
  if (window === 'last_7_days' || window === 'last_30_days') out.timeWindow = { kind: window };
  else if (window === 'custom' && params.get('from') && params.get('to')) out.timeWindow = { kind: 'custom', from: params.get('from')!, to: params.get('to')! };
  const pct = params.get('pct');
  if (pct !== null && pct.trim() !== '' && Number.isFinite(Number(pct))) out.migrationPercentage = Number(pct);
  return out;
}

export function upgradeHref(r: Partial<Pick<UpgradeEstimateRequest, 'currentModelId' | 'candidateModelId' | 'scope' | 'timeWindow' | 'migrationPercentage'>>): string {
  const p = new URLSearchParams();
  if (r.currentModelId) p.set('current', r.currentModelId);
  if (r.candidateModelId) p.set('candidate', r.candidateModelId);
  if (r.scope) p.set('scope', r.scope.level === 'company' ? 'company' : `${r.scope.level}:${r.scope.id}`);
  if (r.timeWindow) {
    p.set('window', r.timeWindow.kind);
    if (r.timeWindow.kind === 'custom') {
      p.set('from', r.timeWindow.from);
      p.set('to', r.timeWindow.to);
    }
  }
  if (r.migrationPercentage !== undefined) p.set('pct', String(r.migrationPercentage));
  return `/assistant/upgrade?${p.toString()}`;
}
