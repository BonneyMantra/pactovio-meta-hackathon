/**
 * List prices, USD per 1M tokens (input / cached input / output), keyed by bare model id. The daily spend cap counts against these.
 * Meta Model API, Standard mode: https://dev.meta.ai/docs/pricing-rate-limits (read 4 Nov 2026). No long-context premium.
 * Contributor-mode models are deliberately absent: they are never used (Meta may train on those prompts).
 */
export const PRICES_ARE_ESTIMATES = false;

export interface Price { in: number; out: number; cachedIn?: number }

const SPARK: Price = { in: 1.25, out: 4.25, cachedIn: 0.15 };
export const PRICES: Record<string, Price> = {
  'muse-spark-1.3': SPARK,
  'muse-spark-1.2': SPARK,
  'muse-spark-1.1': SPARK,
  'muse-wonder-1.0': { in: 4.0, out: 20.0, cachedIn: 0.2 },
};
/** Flex-tier discount is not published as a number, so cost is counted at full list price. */
export const FLEX_MULTIPLIER = 1;

/** Unknown model (e.g. a Fireworks or Modal id): counted at Muse Wonder's price, the most expensive one known. */
const UNKNOWN: Price = { in: 4.0, out: 20.0 };

export function costUsd(model: string, tokensIn: number, tokensOut: number, tokensCached = 0, flex = false): number {
  const bare = model.includes(':') && !(model in PRICES) ? model.slice(model.indexOf(':') + 1) : model;
  const p = PRICES[bare] ?? UNKNOWN;
  const fresh = Math.max(0, tokensIn - tokensCached);
  const usd = (fresh * p.in + tokensCached * (p.cachedIn ?? p.in) + tokensOut * p.out) / 1_000_000;
  return Number((usd * (flex ? FLEX_MULTIPLIER : 1)).toFixed(6));
}
