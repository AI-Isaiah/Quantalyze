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

const PCT_2 = (n: number) => `${(n * 100).toFixed(2)}%`;
const PCT_0 = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Biggest risk right now. At most one sentence — picks the most severe rule
 * that fires. Returns null if no rule fires (the card hides).
 */
export function computeBiggestRisk(
  analytics: PortfolioAnalytics | null,
): PortfolioInsight | null {
  if (!analytics) return null;

  // Rule 1: drawdown still significant relative to peak.
  const dd = analytics.portfolio_max_drawdown;
  if (dd != null && dd < -0.15) {
    return {
      key: "biggest_risk_drawdown",
      severity: "high",
      sentence: `You're still ${PCT_0(Math.abs(dd))} below peak. Worth asking whether the top contributor can carry the recovery.`,
    };
  }

  // Rule 2: concentration risk — top contributor's risk share dwarfs its capital share.
  const risk = analytics.risk_decomposition;
  if (risk && risk.length > 0) {
    const top = [...risk].sort(
      (a, b) => b.marginal_risk_pct - a.marginal_risk_pct,
    )[0];
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
      sentence: `Your portfolio is ${PCT_0(corr)} correlated on average. Concentration risk masked as diversification.`,
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

  let bestKey: string | null = null;
  let bestDelta = 0;
  let bestRecent = 0;
  let bestPrior = 0;
  for (const [pairKey, series] of Object.entries(analytics.rolling_correlation)) {
    if (series.length < window * 2) continue;
    const recent = series.slice(-window);
    const prior = series.slice(-window * 2, -window);
    const recentAvg = recent.reduce((s, p) => s + p.value, 0) / recent.length;
    const priorAvg = prior.reduce((s, p) => s + p.value, 0) / prior.length;
    const delta = Math.abs(recentAvg - priorAvg);
    if (delta > bestDelta) {
      bestDelta = delta;
      bestKey = pairKey;
      bestRecent = recentAvg;
      bestPrior = priorAvg;
    }
  }

  if (bestKey == null || bestDelta < minDelta) return null;

  // Pair keys look like "<sidA>:<sidB>". For the demo we don't have strategy
  // names here (they live on attribution_breakdown), so we anonymize the
  // sentence as "two strategies in your portfolio." If callers want named
  // pairs, they can pass a name lookup later.
  const direction = bestRecent > bestPrior ? "tightened" : "loosened";
  return {
    key: "regime_change",
    severity: "medium",
    sentence: `Correlation regime shift: pairwise correlation ${direction} from ${bestPrior.toFixed(2)} to ${bestRecent.toFixed(2)} between two strategies in your portfolio.`,
  };
}

/**
 * Detect underperformance: a strategy whose contribution is materially
 * negative relative to the rest of the portfolio. Heuristic: contribution
 * < -1% AND it's the worst contributor by at least 0.5% margin.
 */
export function computeUnderperformance(
  analytics: PortfolioAnalytics | null,
): PortfolioInsight | null {
  const attribution = analytics?.attribution_breakdown;
  if (!attribution || attribution.length === 0) return null;
  const sorted = [...attribution].sort((a, b) => a.contribution - b.contribution);
  const worst = sorted[0];
  if (worst.contribution >= -0.01) return null;
  const second = sorted[1];
  if (second && second.contribution - worst.contribution < 0.005) {
    // Multiple strategies are roughly tied for worst — don't single one out.
    return null;
  }
  return {
    key: "underperformance",
    severity: "medium",
    sentence: `${worst.strategy_name} has dragged the portfolio by ${PCT_2(Math.abs(worst.contribution))} over the trailing window.`,
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
  const sorted = [...risk].sort((a, b) => b.weight_pct - a.weight_pct);
  const top = sorted[0];
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
