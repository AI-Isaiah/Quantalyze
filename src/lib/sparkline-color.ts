/**
 * Phase 13 / Plan 13-04 / DISCO-04 — DESIGN.md DIFF-05 single-accent
 * sparkline rule.
 *
 * The Sparkline component renders a single-color trace; the caller picks
 * the color. For sparkline_returns on /discovery/[slug], the color is
 * driven by the FINAL value of the series — not by per-point sign. This
 * avoids the split-color anti-pattern that was reintroduced multiple times
 * historically (see e2e/discovery-sparkline-regression.spec.ts for the
 * regression gate).
 *
 * Drawdown sparklines (StrategyTable.tsx:464) are NOT subject to this
 * rule — they pass color="var(--color-negative)" statically because
 * drawdown is by definition non-positive.
 *
 * Returns CSS-variable strings (not hex literals) so design-token swaps
 * propagate without touching this code.
 */
export function sparklineColor(data: number[]): string {
  if (!data || data.length === 0) return "var(--color-chart-benchmark)";
  const final = data[data.length - 1];
  if (final > 0) return "var(--color-accent)";
  if (final < 0) return "var(--color-negative)";
  return "var(--color-chart-benchmark)";
}
