/**
 * Provider list prices used to ESTIMATE the cost of each request, in USD per million
 * tokens. Real charges come from the provider's bill; costs calculated here are
 * always marked `estimated`, and a model that isn't listed gets no cost at all
 * (`unavailable`) rather than a guess.
 *
 * Anthropic: https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-18).
 * Update PRICE_VERSION whenever a rate changes, so each record says which rates it used.
 */
export const PRICE_VERSION = 'anthropic-2026-10-18';

interface Rate {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface PriceEntry {
  /** Model IDs starting with this prefix (dated snapshots included) use these rates. */
  prefix: string;
  rate: Rate;
  /** Haiku 5.5 charges more when the whole prompt is over 100,000 tokens. */
  longPrompt?: { over: number; rate: Rate };
}

const r = (input: number, output: number, cacheWrite: number, cacheRead: number): Rate => ({ input, output, cacheWrite, cacheRead });

// Longest prefixes first, so "claude-opus-4-5" isn't matched by a shorter entry.
const ANTHROPIC: PriceEntry[] = [
  { prefix: 'claude-fable-5-1', rate: r(10, 50, 12.5, 0.25) },
  { prefix: 'claude-mythos-5-1', rate: r(10, 50, 12.5, 0.25) },
  { prefix: 'claude-opus-5-5', rate: r(4, 20, 5, 0.2) },
  { prefix: 'claude-sonnet-5-5', rate: r(2, 10, 2.5, 0.1) },
  { prefix: 'claude-haiku-5-5', rate: r(0.1, 0.5, 0.125, 0.01), longPrompt: { over: 100_000, rate: r(0.5, 2.5, 0.625, 0.05) } },
  { prefix: 'claude-fable-5', rate: r(10, 50, 12.5, 1) },
  { prefix: 'claude-mythos-5', rate: r(10, 50, 12.5, 1) },
  { prefix: 'claude-opus-5', rate: r(5, 25, 6.25, 0.5) },
  { prefix: 'claude-sonnet-5', rate: r(2, 10, 2.5, 0.2) },
  { prefix: 'claude-opus-4-8', rate: r(5, 25, 6.25, 0.5) },
  { prefix: 'claude-opus-4-7', rate: r(5, 25, 6.25, 0.5) },
  { prefix: 'claude-opus-4-6', rate: r(5, 25, 6.25, 0.5) },
  { prefix: 'claude-opus-4-5', rate: r(5, 25, 6.25, 0.5) },
  { prefix: 'claude-sonnet-4-6', rate: r(3, 15, 3.75, 0.3) },
  { prefix: 'claude-sonnet-4-5', rate: r(3, 15, 3.75, 0.3) },
  { prefix: 'claude-haiku-4-5', rate: r(1, 5, 1.25, 0.1) },
];

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

/** Estimated USD cost, or null when the model has no listed price. */
export function estimateAnthropicCostUsd(model: string, t: TokenCounts): number | null {
  const entry = ANTHROPIC.find((e) => model.startsWith(e.prefix));
  if (!entry) return null;
  const prompt = t.inputTokens + t.cacheWriteTokens + t.cacheReadTokens;
  const rate = entry.longPrompt && prompt > entry.longPrompt.over ? entry.longPrompt.rate : entry.rate;
  return (t.inputTokens * rate.input + t.outputTokens * rate.output + t.cacheWriteTokens * rate.cacheWrite + t.cacheReadTokens * rate.cacheRead) / 1_000_000;
}
