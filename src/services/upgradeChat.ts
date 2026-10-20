/**
 * Upgrade Analysis in the demo assistant's chat: a short, deterministic conversation.
 *
 *   1. Pick out the current model, candidate, scope, time window and migration percentage.
 *   2. Ask only for what's missing, one question at a time.
 *   3. Confirm the assumptions (100% migration only after an explicit yes).
 *   4. Run the same estimate as the Upgrade Analysis view and answer in its report format.
 *   5. Offer to save it as a draft or open it to export.
 *
 * The conversation state travels with each answer (`upgrade`) and comes back with the
 * next question, so nothing is stored. Nothing here changes routing or models.
 */
import { upgradeHref } from '../components/upgrade/params';
import { currentTeams } from '../data/demoStore';
import { applications, DEMO_REPORTING_DATE } from '../data/mockData';
import { demoAgents, demoDefaultRules, demoProjects, demoWorkflows } from '../data/upgradeFixtures';
import { formatCurrency, formatNumber } from '../lib/format';
import { can } from '../lib/permissions';
import {
  CLASSIFICATION_LABELS,
  SCOPE_LEVEL_LABELS,
  summaryLines,
  UpgradeAccessError,
  UpgradeInputError,
  type EligibilityRule,
  type ScopeLevel,
  type TimeWindowInput,
  type UpgradeAnalysis,
  type UpgradeEstimateRequest,
  type UpgradeModelsResponse,
} from '../lib/upgrade';
import type { UserContext } from '../types';
import type { AssistantResponse } from './assistantService';
import { buildDemoUpgradeEstimate, buildDemoUpgradeModels, saveDemoUpgrade } from './upgradeAnalysisService';

type Slot = 'current' | 'candidate' | 'scope' | 'window' | 'pct' | 'confirm';

export interface UpgradeDraft {
  currentModelId?: string;
  candidateModelId?: string;
  scope?: UpgradeEstimateRequest['scope'];
  timeWindow?: TimeWindowInput;
  migrationPercentage?: number;
  /** Rules added for this conversation only, e.g. "non-production only". */
  extraRules: EligibilityRule[];
  /** What was read into the question, said back when confirming. */
  readings: string[];
  /** Rank scopes (e.g. "top 10 workflows") instead of one scope. */
  rank: { levels: ScopeLevel[]; limit: number; by: 'savings' | 'spend' } | null;
  /** Other current models mentioned, for one-at-a-time follow-ups. */
  otherModels: string[];
  awaiting: Slot | null;
  /** Set once an analysis has run, so "save this" knows what to save. */
  lastRequest?: UpgradeEstimateRequest;
  savedId?: string;
}

const emptyDraft = (): UpgradeDraft => ({ extraRules: [], readings: [], rank: null, otherModels: [], awaiting: null });

const has = (q: string, ...words: (string | RegExp)[]) => words.some((w) => (typeof w === 'string' ? q.includes(w) : w.test(q)));

const UPGRADE_WORDS: (string | RegExp)[] = [/\bupgrad/, /\bmigrat/, /\bswitch(ed|es|ing)?\b/, /\bmov(e|ed|ing) (to|over|only)\b/, 'newer', 'new version', 'new model', 'latest version', 'cheaper version', 'faster version'];

/** Does this question start (or continue) an upgrade conversation? */
export function isUpgradeQuestion(q: string, draft: UpgradeDraft | undefined): boolean {
  if (draft?.awaiting) return true;
  if (draft?.lastRequest && has(q, /\bsave\b.*\b(analysis|it|this|draft)\b/, 'as a draft', 'shareable', /\bexport\b/, 'report', /^now analyse/, /^change the (migration|period|scope)/, /\binstead$/)) return true;
  return has(q, ...UPGRADE_WORDS);
}

// ---------------------------------------------------------------------------
// Reading the question
// ---------------------------------------------------------------------------

const CANDIDATE_PATTERNS: [RegExp, string][] = [
  [/flash[- ]?lite/, 'gemini-flash-lite-preview-demo'],
  [/\bpro (2|v2)\b|pro 2 preview|gemini 2 pro/, 'gemini-pro-2-preview-demo'],
  [/\bflash (2|v2)\b/, 'gemini-flash-2-demo'],
  [/\bhaiku (2|v2)\b/, 'claude-haiku-2-demo'],
  [/\bsonnet (2|v2)\b/, 'claude-sonnet-2-demo'],
];

const CURRENT_PATTERNS: [RegExp, string][] = [
  [/\bgemini pro\b(?! ?(2|v2))|\bpro model\b/, 'gemini-pro-demo'],
  [/\bflash\b(?![- ]?(2|v2|lite))/, 'gemini-flash-demo'],
  [/\bsonnet\b(?! ?(2|v2))/, 'claude-sonnet-demo'],
  [/\bhaiku\b(?! ?(2|v2))/, 'claude-haiku-demo'],
];

function mentions(q: string, patterns: [RegExp, string][]): string[] {
  return patterns
    .map(([re, id]) => ({ id, at: q.search(re) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((m) => m.id);
}

function providerMention(q: string): 'gemini_vertex' | 'anthropic' | null {
  if (has(q, 'gemini', 'google', 'vertex')) return 'gemini_vertex';
  if (has(q, 'anthropic', 'claude')) return 'anthropic';
  return null;
}

const OTHER_PROVIDER = /\b(openai|gpt[- ]?\d|gpt-4o|o[134](-mini)?|mistral|llama|cohere|deepseek|grok)\b/;

/** The candidate a current model would most naturally move to: its drop-in upgrade, else any listed path. */
function naturalCandidate(models: UpgradeModelsResponse, currentId: string, family?: string): string | undefined {
  const paths = models.candidateModels.flatMap((c) => c.upgradePaths.filter((p) => p.fromModelId === currentId).map((p) => ({ c, p })));
  const inFamily = family ? paths.filter((x) => x.c.id.includes(family)) : paths;
  return (inFamily.find((x) => x.p.compatibility === 'drop_in') ?? inFamily.find((x) => x.c.pricing) ?? inFamily[0])?.c.id;
}

interface ScopeOptionsByLevel {
  level: ScopeLevel;
  id: string;
  names: string[];
}

function scopeVocabulary(): ScopeOptionsByLevel[] {
  return [
    ...currentTeams().map((t) => ({ level: 'team' as const, id: t.id, names: [t.name.toLowerCase(), `${t.name.split(' ')[0].toLowerCase()} team`, t.code.toLowerCase()] })),
    ...demoProjects.map((p) => ({ level: 'project' as const, id: p.id, names: [p.label.toLowerCase()] })),
    ...applications.map((a) => ({ level: 'application' as const, id: a.id, names: [a.name.toLowerCase(), a.id === 'app-ci-review' ? 'ci bot' : 'summariser bot'] })),
    ...demoWorkflows.map((w) => ({ level: 'workflow' as const, id: w.id, names: [w.label.toLowerCase(), w.label.toLowerCase().replace(/ (comments|checks|use.*)$/, '')] })),
    ...demoAgents.map((a) => ({ level: 'agent' as const, id: a.id, names: [a.label.toLowerCase(), a.label.toLowerCase().replace(/ agent$/, '')] })),
    { level: 'environment', id: 'production', names: ['production only', 'in production', 'production workloads', 'production calls'] },
    { level: 'environment', id: 'staging', names: ['staging'] },
    { level: 'environment', id: 'development', names: ['development', 'dev environment'] },
  ];
}

function readScope(q: string): UpgradeEstimateRequest['scope'] | 'company' | null {
  if (has(q, 'whole company', 'entire company', 'company-wide', 'company wide', 'all teams', 'everyone', 'across the company', /^company$/, 'the company', /\b(all )?my (own )?(\w+ )?(calls|requests|usage)\b/)) return 'company';
  for (const v of scopeVocabulary()) if (v.names.some((n) => n.length > 3 && q.includes(n))) return { level: v.level, id: v.id };
  return null;
}

function readWindow(q: string): TimeWindowInput | null {
  if (has(q, 'last 7 days', 'past 7 days', 'last week', 'past week', 'seven days', /^7 days$/)) return { kind: 'last_7_days' };
  if (has(q, 'last 30 days', 'past 30 days', 'last month', 'past month', 'thirty days', /^30 days$/)) return { kind: 'last_30_days' };
  if (q.includes('september')) return { kind: 'custom', from: '2026-09-01', to: '2026-09-30' };
  if (q.includes('august')) return { kind: 'custom', from: '2026-08-01', to: '2026-08-31' };
  return null;
}

function readPercent(q: string): number | null {
  const m = /(-?\d+(?:\.\d+)?)\s*(%|percent|per cent)/.exec(q);
  if (m) return Number(m[1]);
  if (/^\d{1,3}$/.test(q.trim())) return Number(q.trim());
  return null;
}

const YES = /^(yes|y|yep|yeah|ok|okay|sure|continue|go|go ahead|run it|confirm|correct|that'?s right|please do|do it)\b/;
const CANCEL = /^(cancel|stop|never ?mind|forget it|no thanks)\b/;

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const MODELLED = 'Modelled estimate · not a guaranteed saving';

function ask(draft: UpgradeDraft, slot: Slot, question: string, chips: string[], preface: string[] = []): AssistantResponse {
  return {
    intent: 'upgrade_analysis',
    answer: [...preface, question],
    facts: [],
    figures: {},
    followUps: chips.slice(0, 4),
    upgrade: { ...draft, awaiting: slot },
  };
}

function modelName(models: UpgradeModelsResponse, id: string | undefined): string {
  return [...models.currentModels, ...models.candidateModels].find((m) => m.id === id)?.displayName ?? id ?? 'not chosen';
}

const shortName = (models: UpgradeModelsResponse, id: string | undefined) => modelName(models, id).replace(/ \(illustrative\)$/, '');

function scopeName(models: UpgradeModelsResponse, scope: UpgradeEstimateRequest['scope'] | undefined): string {
  if (!scope) return 'not chosen';
  if (scope.level === 'company') return models.scopes.find((s) => s.level === 'company')?.label ?? 'Company';
  const option = models.scopes.find((s) => s.level === scope.level)?.options.find((o) => o.id === scope.id);
  return `${option?.label ?? scope.id} (${SCOPE_LEVEL_LABELS[scope.level].toLowerCase()})`;
}

function windowName(w: TimeWindowInput | undefined): string {
  if (!w) return 'not chosen';
  return w.kind === 'last_7_days' ? 'the last 7 days' : w.kind === 'last_30_days' ? 'the last 30 days' : `${w.from} to ${w.to}`;
}

function toRequest(draft: UpgradeDraft, scope: UpgradeEstimateRequest['scope']): UpgradeEstimateRequest {
  return {
    currentModelId: draft.currentModelId!,
    candidateModelId: draft.candidateModelId!,
    scope,
    timeWindow: draft.timeWindow!,
    migrationPercentage: draft.migrationPercentage!,
    assumptions: {},
    eligibilityRules: [...demoDefaultRules, ...draft.extraRules],
  };
}

function analysisAnswer(models: UpgradeModelsResponse, a: UpgradeAnalysis, draft: UpgradeDraft): AssistantResponse {
  // The report format, one paragraph per section.
  const paragraphs: string[] = [];
  let section: string[] = [];
  for (const line of summaryLines(a)) {
    if (line === '') {
      if (section.length) paragraphs.push(section.join('\n'));
      section = [];
    } else section.push(line.replace(/\*\*/g, ''));
  }
  if (section.length) paragraphs.push(section.join('\n'));
  if (draft.readings.length) paragraphs.splice(1, 0, `How I read your question: ${draft.readings.join('; ')}.`);
  const f = a.financial;
  const followUps = ['Save this analysis as a draft', `Change the migration percentage to ${a.inputs.migrationPercentage === 50 ? 100 : 50}%`];
  if (draft.otherModels.length) followUps.unshift(`Now analyse ${shortName(models, draft.otherModels[0])}`);
  if (draft.extraRules.length)
    paragraphs.splice(paragraphs.length - 1, 0, 'The Upgrade Analysis page starts from the workspace’s eligibility rules, so add the same exclusions under “Eligibility rules” there to see these figures.');
  return {
    intent: 'upgrade_analysis',
    answer: paragraphs,
    facts: [
      { label: 'Period', value: `${a.period.from} to ${a.period.to} (Australia/Sydney)` },
      { label: 'Currency', value: a.currency },
      { label: 'Basis', value: MODELLED },
      { label: 'Data scope', value: a.scope.label },
    ],
    page: { label: 'Open in Upgrade Analysis', to: upgradeHref(a.inputs) },
    figures: {
      currentCost: f?.currentCost ?? null,
      projectedCost: f?.projectedCost ?? null,
      savings: f?.savings ?? null,
      monthlySavings: f?.monthlySavings ?? null,
      annualisedSavings: f?.annualisedSavings ?? null,
      eligibleCalls: a.eligibility.eligible.requests,
      ineligibleCalls: a.eligibility.ineligible.requests,
      reviewCalls: a.eligibility.requiresReview.requests,
    },
    followUps,
    upgrade: { ...draft, awaiting: null, lastRequest: a.inputs, savedId: undefined },
  };
}

function rankAnswer(models: UpgradeModelsResponse, draft: UpgradeDraft, context: UserContext): AssistantResponse {
  const rank = draft.rank!;
  const rows: { level: ScopeLevel; label: string; a: UpgradeAnalysis }[] = [];
  for (const level of rank.levels) {
    for (const option of models.scopes.find((s) => s.level === level)?.options ?? []) {
      const a = buildDemoUpgradeEstimate(toRequest(draft, { level, id: option.id }), context);
      if (a.current.usage.requests > 0) rows.push({ level, label: option.label, a });
    }
  }
  const value = (r: (typeof rows)[number]) => (rank.by === 'spend' ? r.a.current.usage.cost : (r.a.financial?.monthlySavings ?? -Infinity));
  const top = rows.sort((x, y) => value(y) - value(x)).slice(0, rank.limit);
  const levelsText = rank.levels.map((l) => `${SCOPE_LEVEL_LABELS[l].toLowerCase()}s`).join(' and ');
  const best = top.find((r) => (r.a.financial?.monthlySavings ?? 0) > 0);
  const answer = [
    top.length === 0
      ? `None of the ${levelsText} you can see used ${modelName(models, draft.currentModelId)} in ${windowName(draft.timeWindow)}.`
      : `Here are the ${top.length === 1 ? '' : `top ${top.length} `}${levelsText} using ${modelName(models, draft.currentModelId)} in ${windowName(draft.timeWindow)}, ranked by ${rank.by === 'spend' ? 'current estimated spend' : 'estimated monthly saving'} if ${draft.migrationPercentage}% of eligible calls moved to ${modelName(models, draft.candidateModelId)}.`,
    best
      ? `${best.label} would benefit most: about ${formatCurrency(best.a.financial!.monthlySavings)} a month (${best.a.recommendation.label.toLowerCase()}). Calls that still need review aren’t counted as savings.`
      : 'No scope shows a saving from eligible calls yet; confirm eligibility for the calls that need review to see one.',
    'Estimated savings are modelled from observed usage and stated assumptions. Validate quality, latency, and actual billing before production migration.',
  ];
  return {
    intent: 'upgrade_analysis',
    answer,
    facts: [
      { label: 'Period', value: windowName(draft.timeWindow) },
      { label: 'Currency', value: 'AUD' },
      { label: 'Basis', value: MODELLED },
      { label: 'Data scope', value: scopeName(models, { level: 'company', id: null }) },
    ],
    table: top.length
      ? {
          caption: `Upgrade Analysis by ${levelsText} (modelled projection)`,
          columns: [
            { key: 'name', label: 'Name' },
            { key: 'level', label: 'Level' },
            { key: 'spend', label: 'Current est. cost', align: 'right' },
            { key: 'eligible', label: 'Eligible', align: 'right' },
            { key: 'review', label: 'Needs review', align: 'right' },
            { key: 'saving', label: 'Est. monthly saving', align: 'right' },
            { key: 'rec', label: 'Recommendation' },
          ],
          rows: top.map((r) => ({
            name: r.label,
            level: SCOPE_LEVEL_LABELS[r.level],
            spend: formatCurrency(r.a.current.usage.cost),
            eligible: formatNumber(r.a.eligibility.eligible.requests),
            review: formatNumber(r.a.eligibility.requiresReview.requests),
            saving: r.a.financial ? formatCurrency(r.a.financial.monthlySavings) : 'Not available',
            rec: CLASSIFICATION_LABELS[r.a.recommendation.classification],
          })),
        }
      : undefined,
    page: { label: 'Open in Upgrade Analysis', to: upgradeHref(toRequest(draft, { level: 'company', id: null })) },
    figures: Object.fromEntries(top.map((r) => [`${r.level}:${r.label}`, r.a.financial?.monthlySavings ?? null])),
    followUps: [],
    upgrade: { ...draft, awaiting: null, rank: null, lastRequest: toRequest(draft, { level: 'company', id: null }) },
  };
}

function savedAnswer(draft: UpgradeDraft, context: UserContext, exportAsked: boolean): AssistantResponse {
  const saved = draft.savedId ? null : saveDemoUpgrade(draft.lastRequest!, context, { idempotencyKey: `chat-${JSON.stringify(draft.lastRequest).length}-${Date.now()}` });
  const id = draft.savedId ?? saved!.id;
  return {
    intent: 'upgrade_analysis',
    answer: [
      `Saved as a draft for review. It keeps the inputs, pricing version, scope, the time it was calculated and your access at the time.`,
      exportAsked ? 'Open it in Upgrade Analysis and choose “Export report” to download a shareable Markdown or CSV report.' : 'You can export it as a shareable report from Upgrade Analysis.',
    ],
    facts: [],
    page: { label: 'Open in Upgrade Analysis', to: upgradeHref(draft.lastRequest!) },
    figures: {},
    followUps: [],
    upgrade: { ...draft, savedId: id },
  };
}

/** One turn of the upgrade conversation. `q` is the normalised question. */
export function upgradeTurn(q: string, previous: UpgradeDraft | undefined, context: UserContext): AssistantResponse {
  const models = buildDemoUpgradeModels(context);

  if (previous?.awaiting && CANCEL.test(q)) return { intent: 'upgrade_analysis', answer: ['Okay, I’ve dropped that upgrade analysis.'], facts: [], figures: {}, followUps: [], upgrade: emptyDraft() };
  if (previous?.lastRequest && !previous.awaiting && has(q, /\bsave\b/, 'as a draft', 'shareable', /\bexport\b/, 'report') && !has(q, ...UPGRADE_WORDS.slice(0, 2)))
    return savedAnswer(previous, context, has(q, /\bexport\b/, 'shareable', 'report'));

  const continuing = !!previous?.awaiting || has(q, 'change the', 'instead', /^now analyse/, /^analyse /);
  const draft: UpgradeDraft = continuing && previous ? { ...previous, readings: [...previous.readings], extraRules: [...previous.extraRules], otherModels: [...previous.otherModels] } : emptyDraft();
  if (previous?.lastRequest && !previous.awaiting && continuing) {
    // A follow-up such as "change the migration percentage to 50%" reuses the last analysis.
    const r = previous.lastRequest;
    Object.assign(draft, { currentModelId: r.currentModelId, candidateModelId: r.candidateModelId, scope: r.scope, timeWindow: r.timeWindow, migrationPercentage: r.migrationPercentage });
  }

  if (OTHER_PROVIDER.test(q) && !draft.currentModelId) {
    return ask(draft, 'current', 'Which model would you like to compare instead?', models.currentModels.map((m) => m.displayName.replace(/ \(illustrative\)/, '')), [
      'This workspace only records Gemini on Vertex AI and Anthropic usage, so I can’t analyse an OpenAI or other provider’s model: there’s no observed usage or pricing for it. I can compare one of your current Gemini or Claude models with a newer version.',
    ]);
  }

  // ---- Read what the question says
  const currents = [...new Set(mentions(q, CURRENT_PATTERNS))];
  const explicitCandidates = mentions(q, CANDIDATE_PATTERNS);
  const preface: string[] = [];
  if (/^now analyse/.test(q) && draft.otherModels.length) {
    draft.currentModelId = draft.otherModels.shift();
    draft.candidateModelId = naturalCandidate(models, draft.currentModelId!);
  } else if (currents.length >= 2 && / to | with | for /.test(q.slice(q.search(CURRENT_PATTERNS.find(([, id]) => id === currents[0])![0]))) && !has(q, ' and ')) {
    // "move Sonnet to Haiku": the second family is the destination.
    draft.currentModelId = currents[0];
    draft.candidateModelId = naturalCandidate(models, currents[0], currents[1].split('-')[1]) ?? draft.candidateModelId;
  } else if (currents.length >= 2) {
    draft.currentModelId = currents[0];
    draft.otherModels = currents.slice(1);
    preface.push(`I analyse one model at a time, so I’ll start with ${modelName(models, currents[0])} and can do ${currents.slice(1).map((id) => modelName(models, id)).join(' and ')} next.`);
  } else if (currents.length === 1) {
    draft.currentModelId = currents[0];
  } else if (!draft.currentModelId && draft.awaiting !== 'current' && has(q, 'all our models', 'all models', 'every model', 'each model')) {
    draft.otherModels = models.currentModels.slice(1).map((m) => m.id);
    draft.currentModelId = models.currentModels[0]?.id;
    preface.push(`I analyse one model at a time, so I’ll start with your highest-spend model, ${modelName(models, draft.currentModelId)}.`);
  }
  if (!draft.currentModelId || draft.awaiting === 'current') {
    const provider = providerMention(q);
    const used = models.currentModels.filter((m) => !provider || m.providerId === provider);
    if (used.length === 1 && provider) draft.currentModelId = used[0].id;
  }
  if (explicitCandidates.length) draft.candidateModelId = explicitCandidates[explicitCandidates.length - 1];
  if (draft.currentModelId && !models.currentModels.some((m) => m.id === draft.currentModelId)) {
    const name = modelName(models, draft.currentModelId);
    draft.currentModelId = undefined;
    preface.push(`There’s no ${name} usage you can see in the last 92 days, so I can’t compare it.`);
  }
  if (draft.currentModelId && !draft.candidateModelId) {
    draft.candidateModelId = naturalCandidate(models, draft.currentModelId);
    if (draft.candidateModelId) draft.readings = [...draft.readings.filter((r) => !r.startsWith('the candidate is')), `the candidate is ${modelName(models, draft.candidateModelId)}, the newer version of ${modelName(models, draft.currentModelId)}`];
  }
  if (draft.candidateModelId === draft.currentModelId) draft.candidateModelId = undefined;

  const scope = readScope(q);
  if (scope === 'company') draft.scope = { level: 'company', id: null };
  else if (scope) {
    const allowed = scope.level === 'company' || models.scopes.find((s) => s.level === scope.level)?.options.some((o) => o.id === scope.id);
    if (allowed) draft.scope = scope;
    else preface.push(can(context, 'view_all_teams') ? `There’s no usage in that ${scope.level} you can see.` : 'As an Individual User you can only analyse your own requests, so I can’t use that scope.');
  }
  if (has(q, 'non-production', 'non production', 'nonproduction', 'outside production')) {
    if (!draft.extraRules.some((r) => r.id === 'chat-nonprod')) draft.extraRules.push({ id: 'chat-nonprod', level: 'environment', targetId: 'production', decision: 'exclude', reason: 'Only non-production workloads (your request)' });
    draft.scope ??= { level: 'company', id: null };
    draft.readings.push('only non-production calls can move, so production calls are excluded');
  }
  const window = readWindow(q);
  if (window) draft.timeWindow = window;
  const pct = readPercent(q);
  if (pct !== null) {
    if (pct < 0 || pct > 100) preface.push(`${pct}% isn’t a valid migration percentage: it must be between 0 and 100.`);
    else draft.migrationPercentage = pct;
  } else if (draft.awaiting === 'pct' && YES.test(q)) draft.migrationPercentage = 100;
  if (has(q, /\btop (\d+)\b/, 'highest-spend', 'highest spend', 'benefit most', 'which teams', 'which projects', 'which workflows', 'which agents')) {
    const levels = (['team', 'project', 'workflow', 'agent', 'application'] as ScopeLevel[]).filter((l) => q.includes(l));
    draft.rank = { levels: levels.length ? levels : ['workflow'], limit: Number(/\btop (\d+)\b/.exec(q)?.[1] ?? 10), by: has(q, 'highest-spend', 'highest spend') ? 'spend' : 'savings' };
    draft.scope = { level: 'company', id: null };
  }

  // ---- High-volume workloads: exclude workflows with fewer calls than average on this model
  if (has(q, 'high-volume', 'high volume', 'busiest') && draft.currentModelId && draft.candidateModelId) {
    const probe = { ...draft, timeWindow: draft.timeWindow ?? { kind: 'last_30_days' as const }, migrationPercentage: 100 };
    const perWorkflow = new Map<string, number>();
    for (const option of models.scopes.find((s) => s.level === 'workflow')?.options ?? []) {
      const a = buildDemoUpgradeEstimate(toRequest(probe, { level: 'workflow', id: option.id }), context);
      if (a.current.usage.requests > 0) perWorkflow.set(option.id, a.current.usage.requests);
    }
    const average = [...perWorkflow.values()].reduce((s, n) => s + n, 0) / Math.max(1, perWorkflow.size);
    for (const [id, n] of perWorkflow)
      if (n < average && !draft.extraRules.some((r) => r.targetId === id)) draft.extraRules.push({ id: `chat-low-${id}`, level: 'workflow', targetId: id, decision: 'exclude', reason: 'Not a high-volume workflow (your request)' });
    draft.scope ??= { level: 'company', id: null };
    if (!draft.readings.some((r) => r.startsWith('high-volume'))) draft.readings.push('high-volume means workflows with at least the average number of calls on this model');
  }

  // ---- Ask for the first missing input, one at a time
  if (!draft.currentModelId) {
    const provider = providerMention(q);
    const options = models.currentModels.filter((m) => !provider || m.providerId === provider);
    return ask(draft, 'current', provider ? `Which ${provider === 'anthropic' ? 'Anthropic' : 'Gemini'} model do you use today: ${options.map((m) => m.displayName.replace(/ \(illustrative\)/, '')).join(' or ')}?` : 'Which model do you use today?', options.map((m) => m.displayName.replace(/ \(illustrative\)/, '')), preface);
  }
  if (!draft.candidateModelId) {
    const options = models.candidateModels.filter((c) => c.upgradePaths.some((p) => p.fromModelId === draft.currentModelId));
    return ask(draft, 'candidate', `Which model would ${modelName(models, draft.currentModelId)} move to?`, options.map((m) => m.displayName.replace(/ \(illustrative\)/, '')), preface);
  }
  if (!draft.scope && !draft.rank) {
    const s = models.scopes.filter((x) => x.level !== 'company' && x.options.length > 0);
    return ask(
      draft,
      'scope',
      `Which scope should I analyse: ${can(context, 'view_all_teams') ? 'the whole company' : 'all your own requests'}, or a ${s.map((x) => SCOPE_LEVEL_LABELS[x.level].toLowerCase()).join(', ')}?`,
      [can(context, 'view_all_teams') ? 'The whole company' : 'All my requests', ...s.slice(0, 3).map((x) => x.options[0].label)],
      preface,
    );
  }
  if (!draft.timeWindow) return ask(draft, 'window', 'Which period should I base it on: the last 7 days or the last 30 days?', ['Last 30 days', 'Last 7 days', 'September'], preface);
  if (draft.migrationPercentage === undefined) return ask(draft, 'pct', 'Assuming 100% of eligible calls migrate. Continue?', ['Yes, 100%', '80%', '50%'], preface);

  if (draft.awaiting !== 'confirm' || !YES.test(q) || pct !== null || window || scope) {
    // Confirm the assumptions before giving a recommendation.
    const lines = [
      `Current model: ${modelName(models, draft.currentModelId)}`,
      `Candidate model: ${modelName(models, draft.candidateModelId)}`,
      `Scope: ${draft.rank ? `each ${draft.rank.levels.map((l) => SCOPE_LEVEL_LABELS[l].toLowerCase()).join(' and ')}, ranked` : scopeName(models, draft.scope)}`,
      `Period: ${windowName(draft.timeWindow)} (the demo’s today is ${DEMO_REPORTING_DATE})`,
      `Migration: ${draft.migrationPercentage}% of eligible calls`,
      `Eligibility: the workspace’s ${demoDefaultRules.length} rules${draft.extraRules.length ? ` plus ${draft.extraRules.length} from your question` : ''}; unconfirmed calls count as “requires review”, not savings`,
      'Token use, latency and retries: the candidate’s published expectations (illustrative)',
    ];
    return ask(draft, 'confirm', `Before I calculate, here are my assumptions:\n${lines.map((l) => `• ${l}`).join('\n')}\nShall I run it?`, ['Yes, run it', `Change the migration percentage to ${draft.migrationPercentage === 50 ? 100 : 50}%`, draft.timeWindow?.kind === 'last_7_days' ? 'Use the last 30 days instead' : 'Use the last 7 days instead'], preface);
  }

  try {
    if (draft.rank) return rankAnswer(models, draft, context);
    return analysisAnswer(models, buildDemoUpgradeEstimate(toRequest(draft, draft.scope!), context), draft);
  } catch (e) {
    if (e instanceof UpgradeInputError || e instanceof UpgradeAccessError) return ask({ ...draft }, 'confirm', `${e.message} What would you like to change?`, ['Use the last 30 days instead', 'The whole company']);
    throw e;
  }
}
