/**
 * Gemini on Vertex AI list prices, used to ESTIMATE each request's cost. USD per
 * million tokens, standard pay-as-you-go on the global endpoint. Thinking tokens are
 * billed as output. Requests over 200,000 prompt tokens use a model's long-context
 * rate where it has one.
 *
 * Source: https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
 * (checked 2026-10-18). Some rates change on a date; each rate says until when it applies.
 * A model that isn't listed (including image, live, TTS and "Cyber" variants) gets no cost.
 */
export const VERTEX_PRICE_VERSION = 'vertex-global-2026-10-18';

interface Rate {
  input: number;
  cachedInput: number;
  output: number;
  /** Where audio input costs more than text. */
  audioInput?: number;
}

interface Period {
  /** First day this rate no longer applies (UTC, YYYY-MM-DD). */
  until?: string;
  rate: Rate;
  /** Rate for prompts over 200,000 tokens. */
  longPrompt?: Rate;
}

const r = (input: number, cachedInput: number, output: number, audioInput?: number): Rate => ({ input, cachedInput, output, ...(audioInput !== undefined ? { audioInput } : {}) });
const LONG_PROMPT = 200_000;

const flashPromo: Period[] = [{ until: '2027-01-01', rate: r(0.75, 0.075, 3.75) }, { rate: r(1.5, 0.15, 7.5) }];

const GEMINI: Record<string, Period[]> = {
  'gemini-4-argon': [{ until: '2026-12-01', rate: r(2, 0.1, 10) }, { rate: r(4, 0.2, 20) }],
  'gemini-3.8-flash': flashPromo,
  'gemini-3.7-flash': flashPromo,
  'gemini-3.6-flash': flashPromo,
  'gemini-3.5-flash': [{ rate: r(1.5, 0.15, 9) }],
  'gemini-3.5-flash-lite': [{ rate: r(0.3, 0.03, 2.5) }],
  'gemini-3.1-pro': [{ rate: r(2, 0.2, 12), longPrompt: r(4, 0.4, 18) }],
  'gemini-3.1-flash-lite': [{ rate: r(0.25, 0.025, 1.5, 0.5) }],
  'gemini-2.5-pro': [{ rate: r(1.25, 0.125, 10), longPrompt: r(2.5, 0.25, 15) }],
  'gemini-2.5-flash': [{ rate: r(0.3, 0.03, 2.5, 1) }],
  'gemini-2.5-flash-lite': [{ rate: r(0.1, 0.01, 0.4, 0.3) }],
  'gemini-2.0-flash': [{ rate: r(0.15, 0.15, 0.6, 1) }],
  'gemini-2.0-flash-lite': [{ rate: r(0.075, 0.075, 0.3) }],
};

/** "gemini-2.5-flash-001" and "gemini-3.1-pro-preview-05-2026" are priced as their base model. */
export function baseGeminiModel(model: string): string {
  return model.replace(/-(\d{3}|latest|preview(-\d{2}-\d{2,4})?)$/, '');
}

export interface GeminiTokens {
  /** All prompt tokens, cached ones included (Vertex's promptTokenCount). */
  promptTokens: number;
  cachedTokens: number;
  /** Prompt tokens that were audio, from promptTokensDetails. */
  audioPromptTokens: number;
  /** Answer plus thinking tokens. */
  outputTokens: number;
}

/** Estimated USD cost, or null when it can't be worked out honestly. */
export function estimateVertexCostUsd(model: string, t: GeminiTokens, at: Date): number | null {
  const periods = GEMINI[baseGeminiModel(model)];
  if (!periods) return null;
  const day = at.toISOString().slice(0, 10);
  const period = periods.find((p) => !p.until || day < p.until);
  if (!period) return null;
  const rate = period.longPrompt && t.promptTokens > LONG_PROMPT ? period.longPrompt : period.rate;
  // Cached audio has its own rate that Vertex doesn't break out; don't guess.
  if (rate.audioInput !== undefined && t.audioPromptTokens > 0 && t.cachedTokens > 0) return null;
  const uncached = Math.max(0, t.promptTokens - t.cachedTokens);
  const audio = rate.audioInput !== undefined ? Math.min(t.audioPromptTokens, uncached) : 0;
  const input = (uncached - audio) * rate.input + audio * (rate.audioInput ?? rate.input);
  return (input + t.cachedTokens * rate.cachedInput + t.outputTokens * rate.output) / 1_000_000;
}

export interface GeminiListPrice {
  model: string;
  input: number;
  cachedInput: number;
  output: number;
  /** First day this rate no longer applies (UTC, YYYY-MM-DD), when a change is announced. */
  until: string | null;
}

/** Each priced Gemini model's standard rate on a day, for Upgrade Analysis. Long-context and audio rates aren't included. */
export function geminiListPrices(day: string): GeminiListPrice[] {
  return Object.entries(GEMINI).flatMap(([model, periods]) => {
    const period = periods.find((p) => !p.until || day < p.until);
    return period ? [{ model, input: period.rate.input, cachedInput: period.rate.cachedInput, output: period.rate.output, until: period.until ?? null }] : [];
  });
}
