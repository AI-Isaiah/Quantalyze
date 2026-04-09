/**
 * Portfolio insight sentence generation.
 *
 * Pure derivation: takes a parsed `PortfolioAnalytics` and produces 0-N
 * plain-English insight sentences for the editorial /demo hero. No I/O,
 * no LLM calls, no randomness. Every sentence template is deterministic
 * and traceable to a numeric threshold.
 *
 * The full insight strip on /demo renders the OUTPUT of this module as a
 * row of one-sentence statements. If a rule fires zero insights, the
 * caller (`<InsightStrip>`) shows the fallback "No unusual activity"
 * sentence so the strip never silently disappears.
 */

import type { PortfolioAnalytics } from "./types";

export type InsightSeverity = "high" | "medium" | "low";

export interface PortfolioInsight {
  /** Stable identifier so React can key the rendered sentence. */
  key:
    | "biggest_risk_correlation"
    | "biggest_risk_concentration"
    | "biggest_risk_drawdown"
    | "regime_change"
    | "underperformance"
    | "concentration_creep";
  severity: InsightSeverity;
  sentence: string;
}

function formatPct2(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

function formatPct0(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Biggest risk right now. At most one sentence — picks the most severe rule
 * that fires. Returns null if no rule fires (the card hides).
 */
export function computeBiggestRisk(
  analytics: PortfolioAnalytics | null,
): PortfolioInsight | null {
  if (!analytics) return null;

  // Rule 1: drawdown still significant relative to peak. Only fire when
  // there are multiple strategies — the "top contributor" sentence is
  // nonsensical for a single-holding portfolio (it IS the top contributor).
  const dd = analytics.portfolio_max_drawdown;
  const hasMultipleStrategies =
    (analytics.attribution_breakdown?.length ?? 0) > 1 ||
    (analytics.risk_decomposition?.length ?? 0) > 1;
  if (dd != null && dd < -0.15 && hasMultipleStrategies) {
    return {
      key: "biggest_risk_drawdown",
      severity: "high",
      sentence: `You're still ${formatPct0(Math.abs(dd))} below peak. Worth asking whether the top contributor can carry the recovery.`,
    };
  }

  // Rule 2: concentration risk — top contributor's risk share dwarfs its capital share.
  const risk = analytics.risk_decomposition;
  if (risk && risk.length > 0) {
    const top = risk.reduce((max, r) =>
      r.marginal_risk_pct > max.marginal_risk_pct ? r : max,
    );
    if (top.marginal_risk_pct > top.weight_pct * 1.4 && top.marginal_risk_pct > 30) {
      return {
        key: "biggest_risk_concentration",
        severity: "high",
        sentence: `Risk is concentrated in ${top.strategy_name}: ${Math.round(top.marginal_risk_pct)}% of portfolio volatility on ${Math.round(top.weight_pct)}% of capital.`,
      };
    }
  }

  // Rule 3: high average pairwise correlation — concentration masked as diversification.
  const corr = analytics.avg_pairwise_correlation;
  if (corr != null && corr > 0.5) {
    return {
      key: "biggest_risk_correlation",
      severity: "medium",
      sentence: `Your portfolio is ${formatPct0(corr)} correlated on average. Concentration risk masked as diversification.`,
    };
  }

  return null;
}

/**
 * Detect a correlation regime change. Compares the most recent N points of
 * each pair-keyed series in `rolling_correlation` against the prior N points.
 * Reports whichever pair shifted the most. Returns null if data is missing
 * or the shift is below the noise floor.
 */
export function computeRegimeChange(
  analytics: PortfolioAnalytics | null,
  options: { window?: number; minDelta?: number } = {},
): PortfolioInsight | null {
  const { window = 5, minDelta = 0.15 } = options;
  if (!analytics?.rolling_correlation) return null;

  let best: { delta: number; recent: number; prior: number } | null = null;
  for (const series of Object.values(analytics.rolling_correlation)) {
    if (series.length < window * 2) continue;
    const recent = average(series.slice(-window).map((p) => p.value));
    const prior = average(series.slice(-window * 2, -window).map((p) => p.value));
    const delta = Math.abs(recent - prior);
    if (best == null || delta > best.delta) {
      best = { delta, recent, prior };
    }
  }

  if (best == null || best.delta < minDelta) return null;

  // Pair keys look like "<sidA>:<sidB>". For the demo we don't have strategy
  // names here (they live on attribution_breakdown), so we anonymize the
  // sentence as "two strategies in your portfolio." If callers want named
  // pairs, they can pass a name lookup later.
  const direction = best.recent > best.prior ? "tightened" : "loosened";
  return {
    key: "regime_change",
    severity: "medium",
    sentence: `Correlation regime shift: pairwise correlation ${direction} from ${best.prior.toFixed(2)} to ${best.recent.toFixed(2)} between two strategies in your portfolio.`,
  };
}

/**
 * Detect underperformance: a strategy whose contribution to portfolio
 * return has trailed the portfolio-wide contribution baseline by more
 * than its own standalone vol band.
 *
 * The plan spec says: "a strategy that has trailed its own annualized
 * vol band by >1 std over the last 8 weeks." The analytics service does
 * not expose per-strategy 8-week trailing vol separately, so the seed
 * contract uses the strategy's standalone vol from `risk_decomposition`
 * as the band width proxy. A strategy is underperforming when its
 * contribution is more than 1 standalone-vol worse than the portfolio
 * average contribution AND at least 0.5% absolute margin over the next
 * worst, so we never single out near-ties.
 */
export function computeUnderperformance(
  analytics: PortfolioAnalytics | null,
): PortfolioInsight | null {
  const attribution = analytics?.attribution_breakdown;
  if (!attribution || attribution.length < 2) return null;

  // Build a quick strategy_id → standalone_vol lookup from risk_decomposition.
  const volByStrategy = new Map<string, number>();
  for (const r of analytics?.risk_decomposition ?? []) {
    volByStrategy.set(r.strategy_id, r.standalone_vol);
  }

  const avgContribution =
    attribution.reduce((s, r) => s + r.contribution, 0) / attribution.length;
  const sorted = [...attribution].sort((a, b) => a.contribution - b.contribution);
  const worst = sorted[0];
  const band = volByStrategy.get(worst.strategy_id);
  const trailDistance = avgContribution - worst.contribution;

  // Only fire when the worst contributor trails the portfolio average by
  // more than one standalone vol band. If we don't have a vol band (no
  // risk_decomposition for this strategy), fall back to a 1% absolute trail.
  const threshold = band != null && band > 0 ? band : 0.01;
  if (trailDistance < threshold) return null;

  const second = sorted[1];
  if (second && second.contribution - worst.contribution < 0.005) {
    // Multiple strategies are roughly tied for worst — don't single one out.
    return null;
  }

  return {
    key: "underperformance",
    severity: "medium",
    sentence: `${worst.strategy_name} has trailed the portfolio baseline by ${formatPct2(Math.abs(trailDistance))} over the trailing window.`,
  };
}

/**
 * Detect concentration creep: a single strategy weight far above an equal-weight
 * baseline. Returns null when the portfolio has fewer than 3 strategies (where
 * "concentration" is meaningless) or when the highest weight is reasonable.
 */
export function computeConcentrationCreep(
  analytics: PortfolioAnalytics | null,
): PortfolioInsight | null {
  const risk = analytics?.risk_decomposition;
  if (!risk || risk.length < 3) return null;
  const equalWeight = 100 / risk.length;
  const top = risk.reduce((max, r) => (r.weight_pct > max.weight_pct ? r : max));
  // Trip when the top weight exceeds equal-weight by 50% (e.g. 5 strategies
  // → equal-weight is 20%, trip at 30%).
  if (top.weight_pct < equalWeight * 1.5) return null;
  return {
    key: "concentration_creep",
    severity: "low",
    sentence: `${top.strategy_name} is ${Math.round(top.weight_pct)}% of the portfolio (equal-weight baseline would be ${Math.round(equalWeight)}%).`,
  };
}

/**
 * Run all insight rules and return the ones that fire, ordered by severity
 * (high → low). The /demo InsightStrip renders the top 3.
 */
export function computeAllInsights(
  analytics: PortfolioAnalytics | null,
): PortfolioInsight[] {
  const insights = [
    computeBiggestRisk(analytics),
    computeRegimeChange(analytics),
    computeUnderperformance(analytics),
    computeConcentrationCreep(analytics),
  ].filter((i): i is PortfolioInsight => i !== null);
  const severityRank: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2 };
  return insights.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}
