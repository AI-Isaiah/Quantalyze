import type { PortfolioAnalytics, StrategyAnalytics } from "./types";

/**
 * Compute a composite health score (0-100) for a strategy.
 *
 * Default weights: freshness 25%, track record 25%, Sharpe 20%, drawdown 15%, win rate 15%.
 * Scores are combined as weighted average.
 */

interface WeightConfig {
  freshness: number;
  trackRecord: number;
  sharpe: number;
  drawdown: number;
  winRate: number;
}

const DEFAULT_WEIGHTS: WeightConfig = {
  freshness: 0.25,
  trackRecord: 0.25,
  sharpe: 0.20,
  drawdown: 0.15,
  winRate: 0.15,
};

function freshnessScore(computedAt: string | null): number {
  if (!computedAt) return 0;
  const hours = (Date.now() - new Date(computedAt).getTime()) / (1000 * 60 * 60);
  if (hours < 24) return 100;
  if (hours < 48) return 75;
  if (hours < 168) return 50;
  return 25;
}

function trackRecordScore(startDate: string | null): number {
  if (!startDate) return 0;
  const months = (Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (months >= 24) return 100;
  if (months >= 12) return 80;
  if (months >= 6) return 60;
  if (months >= 3) return 40;
  return 20;
}

function sharpeScore(sharpe: number | null): number {
  if (sharpe == null) return 0;
  if (sharpe >= 3) return 100;
  if (sharpe >= 2) return 80;
  if (sharpe >= 1) return 50;
  if (sharpe >= 0) return 25;
  return 0;
}

function drawdownScore(maxDrawdown: number | null): number {
  if (maxDrawdown == null) return 0;
  const dd = Math.abs(maxDrawdown);
  if (dd <= 0.05) return 100;
  if (dd <= 0.10) return 80;
  if (dd <= 0.25) return 50;
  if (dd <= 0.50) return 25;
  return 0;
}

function winRateScore(analytics: StrategyAnalytics): number {
  const tm = analytics.trade_metrics as Record<string, number> | null;
  const wr = tm?.win_rate;
  if (wr == null) return 50; // neutral if no trade data
  if (wr >= 0.70) return 100;
  if (wr >= 0.60) return 75;
  if (wr >= 0.50) return 50;
  return 25;
}

export function computeHealthScore(
  analytics: StrategyAnalytics,
  startDate: string | null,
  weights: WeightConfig = DEFAULT_WEIGHTS,
): number {
  const scores = {
    freshness: freshnessScore(analytics.computed_at),
    trackRecord: trackRecordScore(startDate),
    sharpe: sharpeScore(analytics.sharpe),
    drawdown: drawdownScore(analytics.max_drawdown),
    winRate: winRateScore(analytics),
  };

  const total =
    scores.freshness * weights.freshness +
    scores.trackRecord * weights.trackRecord +
    scores.sharpe * weights.sharpe +
    scores.drawdown * weights.drawdown +
    scores.winRate * weights.winRate;

  return Math.round(total);
}

export function healthScoreColor(score: number): string {
  if (score >= 80) return "text-positive";
  if (score >= 50) return "text-yellow-500";
  return "text-text-muted";
}

export function healthScoreBg(score: number): string {
  if (score >= 80) return "bg-positive/10";
  if (score >= 50) return "bg-yellow-500/10";
  return "bg-page";
}

/* ────────────────────────────────────────────────────────────
 * Portfolio-level health score (Sprint 4 Intelligence Layer)
 *
 * Composite 0-100 from four equally weighted components (25 pts each):
 *   Sharpe quality, drawdown recovery, correlation spread, capacity.
 * ──────────────────────────────────────────────────────────── */

export const HEALTH_THRESHOLD_HEALTHY = 70;
export const HEALTH_THRESHOLD_MODERATE = 40;

export interface PortfolioHealthScore {
  total: number;
  components: {
    sharpe: number;
    drawdown: number;
    correlation: number;
    capacity: number;
  };
  label: "Healthy" | "Moderate" | "Concerning";
  color: "positive" | "warning" | "negative";
}

function scaleComponent(value: number, min: number, max: number): number {
  if (value >= max) return 25;
  if (value <= min) return 0;
  return Math.round(25 * ((value - min) / (max - min)));
}

export function computePortfolioHealthScore(
  analytics: PortfolioAnalytics | null,
): PortfolioHealthScore | null {
  if (!analytics) return null;

  // Sharpe: 0 pts at <= 0, 25 pts at >= 2.0
  const sharpe = scaleComponent(analytics.portfolio_sharpe ?? 0, 0, 2.0);

  // Drawdown recovery: 25 pts at 0% DD, 0 pts at -30%+. Invert (smaller DD is better).
  const ddAbs = Math.abs(analytics.portfolio_max_drawdown ?? 0);
  const drawdown = scaleComponent(0.30 - ddAbs, 0, 0.30);

  // Correlation spread: 25 pts at avg corr <= 0.1, 0 pts at >= 0.8.
  // Lower correlation = more diversified = better.
  const corrRaw = analytics.avg_pairwise_correlation ?? 0;
  const correlation = scaleComponent(0.8 - corrRaw, 0, 0.7);

  // Capacity: placeholder until position-level capacity data is available.
  const CAPACITY_PLACEHOLDER = 20;
  const capacity = CAPACITY_PLACEHOLDER;

  const total = sharpe + drawdown + correlation + capacity;

  let label: PortfolioHealthScore["label"];
  let color: PortfolioHealthScore["color"];
  if (total >= HEALTH_THRESHOLD_HEALTHY) {
    label = "Healthy";
    color = "positive";
  } else if (total >= HEALTH_THRESHOLD_MODERATE) {
    label = "Moderate";
    color = "warning";
  } else {
    label = "Concerning";
    color = "negative";
  }

  return { total, components: { sharpe, drawdown, correlation, capacity }, label, color };
}
