/**
 * The Upgrade Analysis view, shared by the demo and real workspaces. It only collects
 * choices and displays the UpgradeAnalysis the client returns (the engine in
 * src/lib/upgrade.ts calculates everything). Nothing here changes routing or models.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, HelpCircle, Plus, Save, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { Card, CardHeader } from '../ui/Card';
import { StatCard } from '../ui/StatCard';
import { CountUp } from '../ui/CountUp';
import { SelectField } from '../ui/SelectField';
import { TableScroll } from '../ui/TableScroll';
import { ErrorState, LoadingState } from '../ui/States';
import { downloadText } from '../../lib/csv';
import { formatMoney, formatNumber } from '../../lib/format';
import {
  ELIGIBILITY_LEVEL_LABELS,
  ELIGIBILITY_LEVELS,
  renderMarkdownReport,
  SCOPE_LEVEL_LABELS,
  type Classification,
  type EligibilityLevel,
  type EligibilityRule,
  type ModelProfile,
  type RiskLevel,
  type SavedUpgradeAnalysis,
  type ScopeLevel,
  type UpgradeAnalysis,
  type UpgradeAssumptions,
  type UpgradeEstimateRequest,
  type UpgradeModelsResponse,
} from '../../lib/upgrade';
import type { UpgradeAnalysisClient } from '../../services/upgradeAnalysisService';

export interface UpgradeAnalysisViewProps {
  client: UpgradeAnalysisClient;
  /** False for view-only logins: they can run and download analyses but not save them. */
  canSave: boolean;
  /** Choices handed over in the link (e.g. from the assistant chat). */
  initial?: Partial<Pick<UpgradeEstimateRequest, 'currentModelId' | 'candidateModelId' | 'scope' | 'timeWindow' | 'migrationPercentage'>> & {
    /** Eligibility rules added to the workspace's own (from the assistant chat). */
    extraRules?: EligibilityRule[];
  };
  /** Changes when the viewer changes (demo role switch), so the view starts again. */
  viewerKey: string;
}

const CLASSIFICATION_STYLE: Record<Classification, string> = {
  strongly_recommended: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  recommended_with_validation: 'bg-teal-100 text-teal-900 ring-teal-300',
  conditional: 'bg-amber-100 text-amber-900 ring-amber-300',
  not_recommended: 'bg-red-100 text-red-900 ring-red-300',
  insufficient_data: 'bg-slate-100 text-slate-800 ring-slate-300',
};

const RISK_STYLE: Record<RiskLevel, { className: string; label: string }> = {
  low: { className: 'bg-emerald-50 text-emerald-800 ring-emerald-200', label: 'Low' },
  medium: { className: 'bg-amber-50 text-amber-900 ring-amber-200', label: 'Medium' },
  high: { className: 'bg-red-50 text-red-800 ring-red-200', label: 'High' },
  unknown: { className: 'bg-slate-100 text-slate-700 ring-slate-200', label: 'Unknown' },
};

type AssumptionKey = Exclude<keyof UpgradeAssumptions, 'businessCritical'>;

const ASSUMPTION_FIELDS: { key: AssumptionKey; label: string; hint: string }[] = [
  { key: 'inputTokenChangePct', label: 'Input-token change (%)', hint: 'e.g. 10 for 10% longer prompts' },
  { key: 'outputTokenChangePct', label: 'Output-token change (%)', hint: 'Overrides the model’s expectation' },
  { key: 'cachedTokenSharePct', label: 'Cached share of input (%)', hint: 'Defaults to today’s share' },
  { key: 'reasoningTokensPerRequest', label: 'Reasoning tokens per request', hint: 'Overrides the model’s expectation' },
  { key: 'requestVolumeChangePct', label: 'Request-volume change (%)', hint: 'Once migrated' },
  { key: 'candidateErrorRatePct', label: 'Candidate retry rate (%)', hint: 'Defaults to today’s rate' },
  { key: 'latencyChangePct', label: 'Latency change (%)', hint: 'e.g. -20 for 20% faster' },
  { key: 'migrationCostEstimate', label: 'One-off migration cost', hint: 'Integration, evaluation and testing' },
  { key: 'qualityThreshold', label: 'Quality threshold (0–100)', hint: 'Minimum acceptable score' },
  { key: 'evaluationQualityScore', label: 'Evaluation score (0–100)', hint: 'From your side-by-side test' },
];

type WindowKind = UpgradeEstimateRequest['timeWindow']['kind'];

interface FormState {
  currentModelId: string;
  candidateModelId: string;
  scopeLevel: ScopeLevel;
  scopeId: string;
  windowKind: WindowKind;
  from: string;
  to: string;
  pct: string;
  assumptions: Partial<Record<AssumptionKey, string>>;
  businessCritical: boolean;
  rules: EligibilityRule[];
}

/** The best candidate for a current model: a drop-in upgrade first, then any listed path. */
export function defaultCandidate(models: UpgradeModelsResponse, currentId: string): string {
  const paths = models.candidateModels.flatMap((c) => c.upgradePaths.filter((p) => p.fromModelId === currentId).map((p) => ({ c, p })));
  return (paths.find((x) => x.p.compatibility === 'drop_in') ?? paths[0])?.c.id ?? models.candidateModels.find((c) => c.id !== currentId)?.id ?? '';
}

function initialForm(models: UpgradeModelsResponse, initial: UpgradeAnalysisViewProps['initial'] = {}): FormState {
  const known = (id?: string) => (id && models.currentModels.some((m) => m.id === id) ? id : undefined);
  const currentModelId = known(initial.currentModelId) ?? models.currentModels.find((m) => models.candidateModels.some((c) => c.upgradePaths.some((p) => p.fromModelId === m.id)))?.id ?? models.currentModels[0]?.id ?? '';
  const candidateModelId = initial.candidateModelId && models.candidateModels.some((c) => c.id === initial.candidateModelId) ? initial.candidateModelId : defaultCandidate(models, currentModelId);
  const scopeOk = initial.scope && (initial.scope.level === 'company' || models.scopes.find((s) => s.level === initial.scope!.level)?.options.some((o) => o.id === initial.scope!.id));
  const window = initial.timeWindow ?? { kind: 'last_30_days' as const };
  return {
    currentModelId,
    candidateModelId,
    scopeLevel: scopeOk ? initial.scope!.level : 'company',
    scopeId: scopeOk ? (initial.scope!.id ?? '') : '',
    windowKind: window.kind,
    from: window.kind === 'custom' ? window.from : '',
    to: window.kind === 'custom' ? window.to : models.today,
    pct: String(initial.migrationPercentage ?? 100),
    assumptions: {},
    businessCritical: false,
    rules: [...models.defaultRules.map((r) => ({ ...r })), ...(initial.extraRules ?? [])],
  };
}

/** Turns the form into a request, or explains what's wrong. Numbers are checked again by the engine. */
function toRequest(f: FormState): { request: UpgradeEstimateRequest } | { error: string } {
  const pct = Number(f.pct);
  if (f.pct.trim() === '' || !Number.isFinite(pct)) return { error: 'Enter a migration percentage from 0 to 100.' };
  if (pct < 0 || pct > 100) return { error: 'The migration percentage must be between 0 and 100.' };
  if (!f.currentModelId || !f.candidateModelId) return { error: 'Choose a current and a candidate model.' };
  if (f.scopeLevel !== 'company' && !f.scopeId) return { error: `Choose a ${SCOPE_LEVEL_LABELS[f.scopeLevel].toLowerCase()}.` };
  if (f.windowKind === 'custom' && (!f.from || !f.to)) return { error: 'Choose both dates for a custom range.' };
  const assumptions: UpgradeAssumptions = {};
  for (const { key, label } of ASSUMPTION_FIELDS) {
    const raw = f.assumptions[key]?.trim();
    if (!raw) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) return { error: `${label} must be a number.` };
    assumptions[key] = value;
  }
  if (f.businessCritical) assumptions.businessCritical = true;
  return {
    request: {
      currentModelId: f.currentModelId,
      candidateModelId: f.candidateModelId,
      scope: { level: f.scopeLevel, id: f.scopeLevel === 'company' ? null : f.scopeId },
      timeWindow: f.windowKind === 'custom' ? { kind: 'custom', from: f.from, to: f.to } : { kind: f.windowKind },
      migrationPercentage: pct,
      assumptions,
      eligibilityRules: f.rules,
    },
  };
}

const newKey = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function UpgradeAnalysisView({ client, canSave, initial, viewerKey }: UpgradeAnalysisViewProps) {
  const [models, setModels] = useState<UpgradeModelsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [analysis, setAnalysis] = useState<UpgradeAnalysis | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedUpgradeAnalysis | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saveKey = useRef(newKey());
  const loadSeq = useRef(0);

  const run = async (f: FormState) => {
    const built = toRequest(f);
    if ('error' in built) {
      setRunError(built.error);
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      const result = await client.estimate(built.request);
      setAnalysis(result);
      setSaved(null);
      setActionMessage(null);
      saveKey.current = newKey();
    } catch (e) {
      setRunError(e instanceof Error && e.message ? e.message : 'The analysis couldn’t be run. Please try again.');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    const seq = ++loadSeq.current;
    setModels(null);
    setAnalysis(null);
    setLoadError(null);
    client
      .models()
      .then((m) => {
        if (seq !== loadSeq.current) return;
        setModels(m);
        const f = initialForm(m, initial);
        setForm(f);
        if (f.currentModelId) void run(f);
      })
      .catch((e: unknown) => seq === loadSeq.current && setLoadError(e instanceof Error && e.message ? e.message : 'Models couldn’t be loaded.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, viewerKey]);

  if (loadError) return <Card><ErrorState message={loadError} /></Card>;
  if (!models || !form) return <Card><LoadingState label="Loading models and usage…" /></Card>;
  if (models.currentModels.length === 0)
    return (
      <Card>
        <div className="p-6 text-sm text-slate-600">There’s no usage you can see in the last 92 days, so there’s nothing to analyse yet.</div>
      </Card>
    );

  const set = (patch: Partial<FormState>) => setForm({ ...form, ...patch });
  const money = (v: number | null | undefined, precise = false) => formatMoney(v ?? null, analysis?.currency ?? models.currency, { precise });

  const save = async () => {
    if (!analysis) return null;
    if (saved) return saved;
    setBusy(true);
    try {
      const s = await client.save(analysis.inputs, { idempotencyKey: saveKey.current });
      setSaved(s);
      setActionMessage(`Saved as a draft for review (${s.id}). It keeps these inputs, prices and the time it was calculated.`);
      return s;
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : 'Couldn’t save the analysis.');
      return null;
    } finally {
      setBusy(false);
    }
  };

  const exportReport = async (format: 'markdown' | 'csv') => {
    if (!analysis) return;
    if (!canSave) {
      downloadText(`upgrade-analysis-${analysis.period.to}.md`, renderMarkdownReport(analysis), 'text/markdown;charset=utf-8');
      setActionMessage('Downloaded. View-only logins can’t save, so this report isn’t stored or audited.');
      return;
    }
    const s = await save();
    if (!s) return;
    setBusy(true);
    try {
      const report = await client.exportReport(s.id, format, newKey());
      downloadText(report.filename, report.content, `${report.contentType};charset=utf-8`);
      setActionMessage(`Exported ${format === 'csv' ? 'CSV' : 'Markdown'} report for ${s.id}. The export is recorded in the analysis’s audit history.`);
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : 'Couldn’t export the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <SelectionCard models={models} form={form} set={set} running={running} error={runError} onRun={() => void run(form)} />
      {analysis && (
        <div className={`animate-fade-up space-y-6 transition-opacity ${running ? 'opacity-60' : ''}`} aria-busy={running} aria-live="polite">
          <ResultHeader analysis={analysis} />
          <SavingsSummary analysis={analysis} money={money} />
          <div className="grid gap-6 xl:grid-cols-2">
            <AssumptionsPanel analysis={analysis} money={money} />
            <EligibilityPanel analysis={analysis} />
          </div>
          {analysis.breakdown.length > 0 && <BreakdownTable analysis={analysis} money={money} />}
          <RiskPanel analysis={analysis} />
          <RecommendationPanel analysis={analysis} />
          <Card>
            <CardHeader title="Save or share" description="A saved analysis keeps its inputs, pricing version, scope, timestamp and your access at the time; a later price change never rewrites it." />
            <div className="flex flex-wrap items-center gap-2 p-5">
              <button type="button" className="btn-primary" onClick={() => void save()} disabled={!canSave || busy || !!saved}>
                <Save className="h-4 w-4" aria-hidden /> {saved ? 'Saved' : 'Save analysis'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => void exportReport('markdown')} disabled={busy}>
                <FileText className="h-4 w-4" aria-hidden /> Export report
              </button>
              {canSave && (
                <button type="button" className="btn-secondary" onClick={() => void exportReport('csv')} disabled={busy}>
                  <Download className="h-4 w-4" aria-hidden /> Export CSV
                </button>
              )}
              {!canSave && <p className="text-xs text-slate-500">This is a view-only login, so analyses can’t be saved. Export downloads the report without storing it.</p>}
              {actionMessage && (
                <p role="status" className="w-full text-sm text-slate-700">
                  {actionMessage}
                </p>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function SelectionCard({ models, form, set, running, error, onRun }: { models: UpgradeModelsResponse; form: FormState; set: (p: Partial<FormState>) => void; running: boolean; error: string | null; onRun: () => void }) {
  const scopeLevels = models.scopes.filter((s) => s.level === 'company' || s.options.length > 0);
  const options = models.scopes.find((s) => s.level === form.scopeLevel)?.options ?? [];
  const current = models.currentModels.find((m) => m.id === form.currentModelId);
  const candidates = useMemo(() => {
    const withPath = models.candidateModels.filter((c) => c.upgradePaths.some((p) => p.fromModelId === form.currentModelId));
    const others = models.candidateModels.filter((c) => c.id !== form.currentModelId && !withPath.includes(c));
    return [...withPath, ...others];
  }, [models, form.currentModelId]);
  const label = (m: ModelProfile) => `${m.displayName}${m.status === 'preview' ? ' · preview' : ''}${m.pricing ? '' : ' · no pricing'}`;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    onRun();
  };
  return (
    <Card>
      <CardHeader title="What to compare" description="Choose the model you use today, the newer one you’re considering, where it would apply and for which period." />
      <form onSubmit={onSubmit} className="space-y-5 p-5" aria-label="Upgrade analysis inputs">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SelectField
            label="Scope"
            value={form.scopeLevel}
            onChange={(v) => {
              const level = v as ScopeLevel;
              set({ scopeLevel: level, scopeId: level === 'company' ? '' : (models.scopes.find((s) => s.level === level)?.options[0]?.id ?? '') });
            }}
            options={scopeLevels.map((s) => ({ value: s.level, label: s.level === 'company' ? `Company: ${s.label}` : s.label }))}
          />
          {form.scopeLevel !== 'company' ? (
            <SelectField label={SCOPE_LEVEL_LABELS[form.scopeLevel]} value={form.scopeId} onChange={(v) => set({ scopeId: v })} options={options.map((o) => ({ value: o.id, label: o.label }))} />
          ) : (
            <div className="hidden xl:block" />
          )}
          <SelectField
            label="Current model"
            value={form.currentModelId}
            onChange={(v) => set({ currentModelId: v, candidateModelId: defaultCandidate(models, v) })}
            options={models.currentModels.map((m) => ({ value: m.id, label: `${m.displayName} (${formatNumber(m.observedRequests)} calls)` }))}
          />
          <SelectField label="Candidate model" value={form.candidateModelId} onChange={(v) => set({ candidateModelId: v })} options={candidates.map((m) => ({ value: m.id, label: label(m) }))} />
          <SelectField
            label="Time window"
            value={form.windowKind}
            onChange={(v) => set({ windowKind: v as WindowKind })}
            options={[
              { value: 'last_7_days', label: 'Last 7 days' },
              { value: 'last_30_days', label: 'Last 30 days' },
              { value: 'custom', label: 'Custom range' },
            ]}
          />
          {form.windowKind === 'custom' && (
            <>
              <DateField label="From" value={form.from} max={models.today} onChange={(v) => set({ from: v })} />
              <DateField label="To" value={form.to} max={models.today} onChange={(v) => set({ to: v })} />
            </>
          )}
          <NumberField label="Migration percentage" hint="Share of eligible calls assumed to move" value={form.pct} min={0} max={100} onChange={(v) => set({ pct: v })} />
        </div>
        {current && <p className="text-xs text-slate-500">{current.displayName}: {formatNumber(current.observedRequests)} calls in the last 92 days you can see · {models.currency} · today is {models.today}.</p>}

        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-800">Optional assumptions</summary>
          <div className="grid gap-4 border-t border-slate-100 p-4 sm:grid-cols-2 xl:grid-cols-5">
            {ASSUMPTION_FIELDS.map((a) => (
              <NumberField key={a.key} label={a.label} hint={a.hint} value={form.assumptions[a.key] ?? ''} onChange={(v) => set({ assumptions: { ...form.assumptions, [a.key]: v } })} />
            ))}
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.businessCritical} onChange={(e) => set({ businessCritical: e.target.checked })} className="h-4 w-4 rounded border-slate-300 text-teal-700" />
              Business-critical work
            </label>
          </div>
        </details>

        <RulesEditor models={models} rules={form.rules} onChange={(rules) => set({ rules })} />

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={running}>
          {running ? 'Calculating…' : 'Run analysis'}
        </button>
      </form>
    </Card>
  );
}

function RulesEditor({ models, rules, onChange }: { models: UpgradeModelsResponse; rules: EligibilityRule[]; onChange: (rules: EligibilityRule[]) => void }) {
  const levels = ELIGIBILITY_LEVELS.filter((l) => l === 'company' || l === 'model' || l === 'provider' || (models.scopes.find((s) => s.level === l)?.options.length ?? 0) > 0);
  const targetsFor = (level: EligibilityLevel): { value: string; label: string }[] => {
    if (level === 'company') return [];
    if (level === 'model') return models.currentModels.map((m) => ({ value: m.id, label: m.displayName }));
    if (level === 'provider') return [...new Map(models.currentModels.map((m) => [m.providerId, m.providerName])).entries()].map(([value, label]) => ({ value, label }));
    return (models.scopes.find((s) => s.level === level)?.options ?? []).map((o) => ({ value: o.id, label: o.label }));
  };
  const [level, setLevel] = useState<EligibilityLevel>('company');
  const [target, setTarget] = useState('');
  const [decision, setDecision] = useState<'eligible' | 'exclude'>('eligible');
  const [reason, setReason] = useState('');
  const targets = targetsFor(level);
  const targetLabel = (r: EligibilityRule) => (r.targetId ? (targetsFor(r.level).find((t) => t.value === r.targetId)?.label ?? r.targetId) : 'Everything in scope');
  const add = () => {
    const targetId = level === 'company' ? null : target || targets[0]?.value;
    if (level !== 'company' && !targetId) return;
    onChange([...rules, { id: `rule-${Date.now().toString(36)}`, level, targetId: targetId ?? null, decision, reason: reason.trim().slice(0, 200) }]);
    setReason('');
  };
  return (
    <fieldset className="rounded-lg border border-slate-200 p-4">
      <legend className="px-1 text-sm font-medium text-slate-800">Eligibility rules</legend>
      <p className="text-xs text-slate-500">A call counts toward savings only when a rule confirms it. Exclusions always win. Unconfirmed calls show as “requires review”.</p>
      {rules.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No rules yet, so every call requires review.</p>
      ) : (
        <ul className="mt-3 space-y-2" aria-label="Eligibility rules">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
              <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.decision === 'eligible' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>{r.decision === 'eligible' ? 'Eligible' : 'Excluded'}</span>
              <span className="text-slate-800">
                {ELIGIBILITY_LEVEL_LABELS[r.level]}: {targetLabel(r)}
              </span>
              {r.reason && <span className="text-slate-500">· {r.reason}</span>}
              <button type="button" className="ml-auto text-slate-500 hover:text-red-700" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} aria-label={`Remove rule ${ELIGIBILITY_LEVEL_LABELS[r.level]} ${targetLabel(r)}`}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SelectField label="Rule level" value={level} onChange={(v) => { setLevel(v as EligibilityLevel); setTarget(''); }} options={levels.map((l) => ({ value: l, label: ELIGIBILITY_LEVEL_LABELS[l] }))} />
        {level !== 'company' ? <SelectField label="Applies to" value={target || targets[0]?.value || ''} onChange={setTarget} options={targets} /> : <div className="hidden xl:block" />}
        <SelectField label="Decision" value={decision} onChange={(v) => setDecision(v as 'eligible' | 'exclude')} options={[{ value: 'eligible', label: 'Eligible to migrate' }, { value: 'exclude', label: 'Exclude' }]} />
        <div>
          <label htmlFor="rule-reason" className="mb-1 block text-xs font-medium text-slate-600">Reason (optional)</label>
          <input id="rule-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button type="button" className="btn-secondary self-end" onClick={add}>
          <Plus className="h-4 w-4" aria-hidden /> Add rule
        </button>
      </div>
      {models.notes.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-500">{models.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </fieldset>
  );
}

function DateField({ label, value, max, onChange }: { label: string; value: string; max: string; onChange: (v: string) => void }) {
  const id = `date-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input id={id} type="date" value={value} max={max} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
    </div>
  );
}

function NumberField({ label, hint, value, onChange, min, max }: { label: string; hint?: string; value: string; onChange: (v: string) => void; min?: number; max?: number }) {
  const id = `num-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input id={id} type="number" inputMode="decimal" step="any" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums" />
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Label({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'warning' }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone === 'warning' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-sky-50 text-sky-900 ring-sky-200'}`}>{children}</span>;
}

function ResultHeader({ analysis: a }: { analysis: UpgradeAnalysis }) {
  const c = a.recommendation.classification;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset ${CLASSIFICATION_STYLE[c]}`} data-testid="recommendation-badge">
        {c === 'not_recommended' ? <XCircle className="h-4 w-4" aria-hidden /> : c === 'insufficient_data' ? <HelpCircle className="h-4 w-4" aria-hidden /> : c === 'conditional' ? <AlertTriangle className="h-4 w-4" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
        Recommendation: {a.recommendation.label}
      </span>
      <Label>Estimated savings</Label>
      <Label>Modelled projection</Label>
      <Label>Based on observed usage</Label>
      {c !== 'strongly_recommended' && <Label tone="warning">Requires validation</Label>}
      <Label tone="warning">Not a guaranteed saving</Label>
    </div>
  );
}

function SavingsSummary({ analysis: a, money }: { analysis: UpgradeAnalysis; money: (v: number | null | undefined, precise?: boolean) => string }) {
  const f = a.financial;
  if (!f)
    return (
      <Card>
        <div className="flex items-start gap-3 p-5 text-sm text-slate-800">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden />
          <div>
            <p className="font-medium">{a.recommendation.reasons[0]}</p>
            <p className="mt-1 text-slate-600">
              Observed: {formatNumber(a.current.usage.requests)} {a.current.displayName} calls in {a.scope.label}, {a.period.label}
              {a.current.usage.costedRequests > 0 ? `, ${money(a.current.usage.cost)} estimated cost` : ''}.
            </p>
          </div>
        </div>
      </Card>
    );
  return (
    <section aria-label="Savings summary" className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <StatCard label="Current estimated cost" value={<MoneyCountUp value={f.currentCost} money={money} />} detail={`${a.period.days} days · based on observed usage`} />
      <StatCard label="Projected cost" value={<MoneyCountUp value={f.projectedCost} money={money} />} detail="Modelled projection" />
      <StatCard label="Estimated monthly savings" value={<MoneyCountUp value={f.monthlySavings} money={money} />} detail={`${money(f.currentMonthlyCost)} → ${money(f.projectedMonthlyCost)} a month`} tone={f.savings < 0 ? 'warning' : 'default'} />
      <StatCard label="Estimated annualised savings" value={<MoneyCountUp value={f.annualisedSavings} money={money} />} detail="Extrapolation: monthly × 12" tone={f.savings < 0 ? 'warning' : 'default'} />
      <StatCard label="Percentage reduction" value={f.savingsPct === null ? 'Not available' : <CountUp value={f.savingsPct} format={(n) => `${n.toFixed(1)}%`} />} detail={f.oneOffMigrationCost !== null ? `One-off cost ${money(f.oneOffMigrationCost)} (separate)` : 'Not a guaranteed saving'} />
    </section>
  );
}

function MoneyCountUp({ value, money }: { value: number | null; money: (v: number | null | undefined) => string }) {
  return value === null ? <>{money(value)}</> : <CountUp value={value} format={money} />;
}

function AssumptionsPanel({ analysis: a, money }: { analysis: UpgradeAnalysis; money: (v: number | null | undefined, precise?: boolean) => string }) {
  const u = a.current.usage;
  const p = a.candidate.projection;
  const rows: [string, ReactNode][] = [
    ['Scope', a.scope.label],
    ['Period', a.period.label],
    ['Current model', `${a.current.providerName} / ${a.current.displayName} / ${a.current.version}`],
    ['Candidate model', `${a.candidate.providerName} / ${a.candidate.displayName} / ${a.candidate.version}`],
    ['Migration assumption', `${a.migrationPercentage}% of eligible calls`],
    ['Currency', a.currency],
    ['Pricing basis', `Current: ${a.basis.current} cost from observed usage (${a.current.pricing?.pricingVersion ?? 'no price list'}). Candidate: modelled at ${a.candidate.pricing?.pricingVersion ?? 'no supported price'}.`],
    ['Today per call', `${formatNumber(u.avgInputTokens)} input · ${formatNumber(u.avgCachedTokens)} cached · ${formatNumber(u.avgOutputTokens)} output · ${money(u.costPerRequest, true)} · ${u.avgLatencyMs === null ? 'latency not recorded' : `${formatNumber(u.avgLatencyMs)} ms`}`],
    ['Expected per call', p.costPerRequest === null ? 'Not available' : `${formatNumber(p.avgInputTokens)} input · ${formatNumber(p.avgCachedTokens)} cached · ${formatNumber(p.avgOutputTokens)} output · ${formatNumber(p.avgReasoningTokens)} reasoning · ${money(p.costPerRequest, true)}${p.avgLatencyMs === null ? '' : ` · ${formatNumber(p.avgLatencyMs)} ms`}`],
  ];
  if (a.financial?.costPerSuccessfulRequest.current != null) rows.push(['Cost per successful call', `${money(a.financial.costPerSuccessfulRequest.current, true)} → ${money(a.financial.costPerSuccessfulRequest.projected, true)}`]);
  return (
    <Card>
      <CardHeader title="Assumptions" description="What the projection is based on, in plain language." />
      <div className="space-y-4 p-5 text-sm">
        <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-500">{k}</dt>
              <dd className="text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calculation basis</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">{a.calculationBasis.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
        {a.notices.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Worth knowing</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-700">{a.notices.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
      </div>
    </Card>
  );
}

function EligibilityPanel({ analysis: a }: { analysis: UpgradeAnalysis }) {
  const e = a.eligibility;
  const tile = (label: string, b: typeof e.eligible, tone: string) => (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{formatNumber(b.requests)}</p>
      <p className="text-xs">{(b.share * 100).toFixed(1)}% of calls</p>
    </div>
  );
  return (
    <Card>
      <CardHeader title="Eligibility" description={`${formatNumber(a.current.usage.requests)} ${a.current.displayName} calls in scope. Only eligible calls count toward savings.`} />
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          {tile('Eligible calls', e.eligible, 'border-emerald-200 bg-emerald-50 text-emerald-900')}
          {tile('Ineligible calls', e.ineligible, 'border-red-200 bg-red-50 text-red-900')}
          {tile('Requires review', e.requiresReview, 'border-amber-200 bg-amber-50 text-amber-900')}
        </div>
        {e.reasons.length > 0 && (
          <ul className="space-y-1 text-sm text-slate-700" aria-label="Why calls are ineligible or need review">
            {e.reasons.map((r) => (
              <li key={`${r.status}:${r.reason}`}>
                <span className="font-medium">{r.status === 'ineligible' ? 'Ineligible' : 'Requires review'}:</span> {r.reason} ({formatNumber(r.requests)})
              </li>
            ))}
          </ul>
        )}
        {e.mixedWorkflows.length > 0 && <p className="text-xs text-slate-500">Workflows with both eligible and other calls: {e.mixedWorkflows.join(', ')}.</p>}
      </div>
    </Card>
  );
}

function BreakdownTable({ analysis: a, money }: { analysis: UpgradeAnalysis; money: (v: number | null | undefined, precise?: boolean) => string }) {
  return (
    <Card>
      <CardHeader title="Cost breakdown" description="Today versus the modelled projection, for the whole scope. Requires validation." />
      <TableScroll label="Cost breakdown">
        <table className="w-full min-w-[720px] text-sm tabular-nums">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium">Item</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Current</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Projected</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Current cost</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Projected cost</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {a.breakdown.map((r) => (
              <tr key={r.id}>
                <th scope="row" className="px-4 py-2 text-left font-medium text-slate-800">{r.label}</th>
                <td className="px-4 py-2 text-right">{formatNumber(r.currentQuantity)}</td>
                <td className="px-4 py-2 text-right">{formatNumber(r.projectedQuantity)}</td>
                <td className="px-4 py-2 text-right">{money(r.currentCost)}</td>
                <td className="px-4 py-2 text-right">{money(r.projectedCost)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {a.impacts.length > 0 && (
        <div className="border-t border-slate-100 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">What changed, for the calls that move</h3>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {a.impacts.map((i) => (
              <li key={i.id} className="flex justify-between gap-3">
                <span className="text-slate-600">{i.label}</span>
                <span className="tabular-nums text-slate-900">
                  {i.amount > 0 ? '+' : i.amount < 0 ? '−' : ''}
                  {money(Math.abs(i.amount))}
                  {i.pctOfMigrated !== null && ` (${i.pctOfMigrated > 0 ? '+' : ''}${(i.pctOfMigrated * 100).toFixed(1)}%)`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function RiskPanel({ analysis: a }: { analysis: UpgradeAnalysis }) {
  return (
    <Card>
      <CardHeader title="Risks" description="Checked for every analysis. A cheaper model may use more tokens, need more retries or fall short on quality." />
      <ul className="divide-y divide-slate-100" aria-label="Risks">
        {a.risks.map((r) => (
          <li key={r.kind} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
            <span className={`inline-flex w-20 justify-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${RISK_STYLE[r.level].className}`}>{RISK_STYLE[r.level].label}</span>
            <span className="w-40 font-medium text-slate-900">{r.label}</span>
            <span className="min-w-0 flex-1 text-slate-700">{r.detail}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RecommendationPanel({ analysis: a }: { analysis: UpgradeAnalysis }) {
  return (
    <Card>
      <CardHeader title={`Recommendation: ${a.recommendation.label}`} description="Worked out by fixed rules from the figures above, never by assuming a newer model is better." />
      <div className="space-y-4 p-5 text-sm text-slate-800">
        <ul className="list-disc space-y-1 pl-5">{a.recommendation.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p>
          <span className="font-semibold">Suggested next step:</span> {a.nextStep}
        </p>
        {a.rolloutPlan && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Suggested rollout plan</h3>
            <p className="text-xs text-slate-500">A proposal only. AxiomFlo never changes production routing or model dependencies; every step needs explicit human approval.</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">{a.rolloutPlan.map((s) => <li key={s}>{s}</li>)}</ol>
          </div>
        )}
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{a.disclaimer}</p>
      </div>
    </Card>
  );
}
