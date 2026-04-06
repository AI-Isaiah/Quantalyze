import type { StrategyAnalytics } from "./types";

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

function freshnesScore(computedAt: string | null): number {
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
    freshness: freshnesScore(analytics.computed_at),
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
