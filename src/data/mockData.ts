/**
 * DEMONSTRATION DATASET — sample data only.
 *
 * Company, people, provider connections, model identifiers and prices are
 * illustrative. Prices are NOT current provider pricing. Request records are
 * generated deterministically (fixed seed) so every page, test and export sees
 * exactly the same numbers on every machine.
 */
import type {
  Application,
  Company,
  CostStatus,
  Department,
  Model,
  PricingVersion,
  Principal,
  Provider,
  ProviderConnection,
  ProviderId,
  RequestStatus,
  Team,
  UsageRecord,
  User,
} from '../types';

/** The fixed "today" of the demo workspace, so the UI never goes empty as real time passes. */
export const DEMO_REPORTING_DATE = '2026-09-30';

export const company: Company = {
  id: 'co-acme',
  name: 'Acme Innovation',
  reportingCurrency: 'AUD',
  reportingTimezone: 'Australia/Sydney',
};

export const department: Department = {
  id: 'dept-pe',
  companyId: company.id,
  name: 'Product & Engineering',
};

export const teams: Team[] = [
  { id: 'team-platform', departmentId: department.id, name: 'Platform Engineering', code: 'ENG-PLATFORM' },
  { id: 'team-product', departmentId: department.id, name: 'Product Experience', code: 'ENG-PRODUCT' },
];

export const users: User[] = [
  { id: 'u-maya', name: 'Maya Chen', email: 'maya.chen@acme.example', role: 'company_admin', teamId: 'team-platform', status: 'active', title: 'Head of Engineering Operations' },
  { id: 'u-liam', name: "Liam O'Connor", email: 'liam.oconnor@acme.example', role: 'individual_user', teamId: 'team-platform', status: 'active', title: 'Senior Platform Engineer' },
  { id: 'u-aisha', name: 'Aisha Rahman', email: 'aisha.rahman@acme.example', role: 'individual_user', teamId: 'team-platform', status: 'active', title: 'Site Reliability Engineer' },
  { id: 'u-noah', name: 'Noah Williams', email: 'noah.williams@acme.example', role: 'individual_user', teamId: 'team-product', status: 'active', title: 'Product Engineer' },
  { id: 'u-sofia', name: 'Sofia Rossi', email: 'sofia.rossi@acme.example', role: 'individual_user', teamId: 'team-product', status: 'active', title: 'Product Designer' },
  { id: 'u-ethan', name: 'Ethan Park', email: 'ethan.park@acme.example', role: 'individual_user', teamId: 'team-product', status: 'active', title: 'Data Analyst' },
];

export const applications: Application[] = [
  { id: 'app-ci-review', name: 'CI code-review bot', teamId: 'team-platform' },
  { id: 'app-support-summary', name: 'Support ticket summariser', teamId: 'team-product' },
];

/** Demo personas offered by the role switcher. */
export const DEMO_PERSONAS = {
  company_admin: 'u-maya',
  individual_user: 'u-noah',
} as const;

export const providers: Provider[] = [
  { id: 'gemini_vertex', name: 'Gemini on Vertex AI', shortName: 'Gemini' },
  { id: 'anthropic', name: 'Anthropic', shortName: 'Claude' },
];

/** Illustrative model identifiers. */
export const models: Model[] = [
  { id: 'gemini-pro-demo', providerId: 'gemini_vertex', displayName: 'Gemini Pro (illustrative)' },
  { id: 'gemini-flash-demo', providerId: 'gemini_vertex', displayName: 'Gemini Flash (illustrative)' },
  { id: 'claude-sonnet-demo', providerId: 'anthropic', displayName: 'Claude Sonnet (illustrative)' },
  { id: 'claude-haiku-demo', providerId: 'anthropic', displayName: 'Claude Haiku (illustrative)' },
];

/** Illustrative AUD rates. NOT current provider pricing. */
export const pricingVersions: PricingVersion[] = [
  {
    id: 'demo-pricing-v1',
    label: 'Illustrative pricing v1 (sample)',
    effectiveFrom: '2026-01-01',
    currency: 'AUD',
    rates: [
      { modelId: 'gemini-pro-demo', inputPerMillion: 1.9, outputPerMillion: 15.2 },
      { modelId: 'gemini-flash-demo', inputPerMillion: 0.46, outputPerMillion: 3.8 },
      { modelId: 'claude-sonnet-demo', inputPerMillion: 4.6, outputPerMillion: 23.0 },
      { modelId: 'claude-haiku-demo', inputPerMillion: 1.5, outputPerMillion: 7.6 },
    ],
  },
];

export const providerConnections: ProviderConnection[] = [
  {
    id: 'conn-gemini',
    providerId: 'gemini_vertex',
    displayName: 'Acme Vertex AI (demo)',
    status: 'connected_demo',
    lastSimulatedTestAt: '2026-09-29T23:15:00Z',
    configSummary: 'Project acme-ai-pilot-demo · australia-southeast1 · service account ••••@acme-ai-pilot-demo',
  },
  {
    id: 'conn-anthropic',
    providerId: 'anthropic',
    displayName: 'Acme Anthropic (demo)',
    status: 'connected_demo',
    lastSimulatedTestAt: '2026-09-28T22:40:00Z',
    configSummary: 'API key sk-ant-••••••••demo (sample, not a real key)',
  },
];

// ---------------------------------------------------------------------------
// Deterministic request generation
// ---------------------------------------------------------------------------

/** Small seeded PRNG (mulberry32) so the dataset is identical on every run. */
function createRandom(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CallerProfile {
  principal: Principal;
  teamId: string;
  /** Average requests per working day. */
  perDay: number;
  /** Weighted model choices, separately for August and September. */
  modelMix: { aug: [string, number][]; sep: [string, number][] };
  inputRange: [number, number];
  outputRange: [number, number];
}

const callers: CallerProfile[] = [
  {
    principal: { type: 'user', id: 'u-maya' }, teamId: 'team-platform', perDay: 3,
    modelMix: { aug: [['gemini-pro-demo', 1], ['claude-sonnet-demo', 1]], sep: [['gemini-pro-demo', 1], ['claude-sonnet-demo', 1]] },
    inputRange: [2_000, 18_000], outputRange: [300, 2_500],
  },
  {
    principal: { type: 'user', id: 'u-liam' }, teamId: 'team-platform', perDay: 12,
    modelMix: { aug: [['claude-sonnet-demo', 3], ['gemini-pro-demo', 1]], sep: [['claude-sonnet-demo', 3], ['gemini-pro-demo', 1]] },
    inputRange: [12_000, 140_000], outputRange: [800, 4_000],
  },
  {
    principal: { type: 'user', id: 'u-aisha' }, teamId: 'team-platform', perDay: 8,
    modelMix: { aug: [['gemini-flash-demo', 3], ['claude-haiku-demo', 1]], sep: [['gemini-flash-demo', 3], ['claude-haiku-demo', 1]] },
    inputRange: [3_000, 30_000], outputRange: [200, 2_000],
  },
  {
    principal: { type: 'application', id: 'app-ci-review' }, teamId: 'team-platform', perDay: 45,
    modelMix: { aug: [['gemini-flash-demo', 4], ['gemini-pro-demo', 1]], sep: [['gemini-flash-demo', 4], ['gemini-pro-demo', 1]] },
    inputRange: [8_000, 45_000], outputRange: [400, 1_800],
  },
  {
    principal: { type: 'user', id: 'u-noah' }, teamId: 'team-product', perDay: 10,
    modelMix: { aug: [['claude-haiku-demo', 2], ['gemini-flash-demo', 1]], sep: [['claude-sonnet-demo', 2], ['claude-haiku-demo', 1]] },
    inputRange: [2_000, 25_000], outputRange: [300, 3_000],
  },
  {
    principal: { type: 'user', id: 'u-sofia' }, teamId: 'team-product', perDay: 6,
    modelMix: { aug: [['gemini-flash-demo', 2], ['claude-haiku-demo', 1]], sep: [['gemini-flash-demo', 2], ['claude-sonnet-demo', 1]] },
    inputRange: [1_000, 12_000], outputRange: [200, 1_500],
  },
  {
    principal: { type: 'user', id: 'u-ethan' }, teamId: 'team-product', perDay: 7,
    modelMix: { aug: [['gemini-pro-demo', 1], ['claude-haiku-demo', 1]], sep: [['gemini-pro-demo', 1], ['claude-sonnet-demo', 1]] },
    inputRange: [8_000, 90_000], outputRange: [500, 3_500],
  },
  {
    principal: { type: 'application', id: 'app-support-summary' }, teamId: 'team-product', perDay: 30,
    modelMix: { aug: [['claude-haiku-demo', 3], ['gemini-flash-demo', 1]], sep: [['claude-haiku-demo', 3], ['claude-sonnet-demo', 1]] },
    inputRange: [3_000, 20_000], outputRange: [200, 1_200],
  },
];

function pickWeighted(rand: () => number, options: [string, number][]): string {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return options[options.length - 1][0];
}

function between(rand: () => number, [min, max]: [number, number]): number {
  return Math.round(min + rand() * (max - min));
}

function generateUsageRecords(): UsageRecord[] {
  const rand = createRandom(20260930);
  const records: UsageRecord[] = [];
  let sequence = 1;

  // Sydney calendar days for August and September 2026.
  const months: { year: number; month: number; days: number; key: 'aug' | 'sep'; volume: number }[] = [
    { year: 2026, month: 8, days: 31, key: 'aug', volume: 1 },
    // September carries more volume, so period-over-period comparisons have something to explain.
    { year: 2026, month: 9, days: 30, key: 'sep', volume: 1.3 },
  ];

  for (const m of months) {
    for (let day = 1; day <= m.days; day++) {
      const weekday = new Date(Date.UTC(m.year, m.month - 1, day)).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      for (const caller of callers) {
        const expected = caller.perDay * m.volume * (weekend ? 0.15 : 1);
        const count = Math.floor(expected + rand());
        for (let i = 0; i < count; i++) {
          // Local Sydney hour 08:00–19:59. Aug–Sep 2026 is AEST (UTC+10); daylight
          // saving only starts on 4 Oct 2026, after this dataset ends.
          const localHour = 8 + Math.floor(rand() * 12);
          const minute = Math.floor(rand() * 60);
          const second = Math.floor(rand() * 60);
          const timestamp = new Date(Date.UTC(m.year, m.month - 1, day, localHour - 10, minute, second)).toISOString();

          const modelId = pickWeighted(rand, caller.modelMix[m.key]);
          const providerId: ProviderId = modelId.startsWith('gemini') ? 'gemini_vertex' : 'anthropic';
          const team = teams.find((t) => t.id === caller.teamId)!;

          let inputTokens: number | null = between(rand, caller.inputRange);
          let outputTokens: number | null = between(rand, caller.outputRange);
          let requestStatus: RequestStatus = 'succeeded';

          const outcome = rand();
          if (outcome < 0.02) {
            // Failed after the prompt was processed: input is still measured (and costed).
            requestStatus = 'failed';
            outputTokens = 0;
          } else if (outcome < 0.035) {
            // Failed with no usage reported: cost cannot be calculated.
            requestStatus = 'failed';
            inputTokens = null;
            outputTokens = null;
          } else if (outcome < 0.045) {
            // Succeeded, but the provider response carried no usage block.
            inputTokens = null;
            outputTokens = null;
          }

          const hasUsage = inputTokens !== null && outputTokens !== null;
          let costStatus: CostStatus;
          if (!hasUsage) costStatus = 'unavailable';
          else if (m.key === 'aug') costStatus = rand() < 0.97 ? 'reconciled' : 'estimated';
          else costStatus = day <= 7 && rand() < 0.6 ? 'reconciled' : 'estimated';

          const id = `req_${m.year}${String(m.month).padStart(2, '0')}${String(day).padStart(2, '0')}_${team.code.toLowerCase()}_${String(sequence).padStart(5, '0')}`;
          sequence++;

          records.push({
            id,
            timestamp,
            principal: caller.principal,
            teamId: team.id,
            teamCode: team.code,
            providerId,
            modelId,
            inputTokens,
            outputTokens,
            requestStatus,
            costStatus,
          });
        }
      }
    }
  }

  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export const usageRecords: UsageRecord[] = generateUsageRecords();
