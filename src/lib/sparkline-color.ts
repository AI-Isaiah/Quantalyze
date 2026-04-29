/**
 * Sparkline color helper — Phase 13 / Plan 13-04 / DISCO-04 contract
 * (DESIGN.md DIFF-05 single-accent rule).
 *
 * Exposed in two layers so callers can choose granularity:
 *   - `SparklineTone` — discriminated union of {positive, negative, neutral}
 *   - `SPARKLINE_TONE_COLOR` — Record<SparklineTone, css-var-string>
 *   - `sparklineTone(values)` — classify a returns series into a tone
 *   - `sparklineColor(values)` — backward-compatible wrapper that returns
 *     the CSS variable string directly. Existing call sites are
 *     unchanged.
 *
 * Token swaps in DESIGN.md propagate automatically — the CSS variable
 * names are the single source of truth.
 */

export type SparklineTone = "positive" | "negative" | "neutral";

export const SPARKLINE_TONE_COLOR: Record<SparklineTone, string> = {
  positive: "var(--color-accent)",
  negative: "var(--color-negative)",
  neutral: "var(--color-chart-benchmark)",
};

export function sparklineTone(data: number[]): SparklineTone {
  if (!data || data.length === 0) return "neutral";
  const final = data[data.length - 1];
  if (final > 0) return "positive";
  if (final < 0) return "negative";
  return "neutral";
}

export function sparklineColor(data: number[]): string {
  return SPARKLINE_TONE_COLOR[sparklineTone(data)];
}
