import { cn } from "@/lib/utils";
import { SHORT_TRACK_MARKER, shortTrackMarkerTitle } from "@/lib/figure-gate";

const PERCENTILE_METRIC_LABELS: Record<string, string> = {
  cagr: "CAGR",
  sharpe: "Sharpe",
  sortino: "Sortino",
  calmar: "Calmar",
  max_drawdown: "Max DD",
  volatility: "Volatility",
  cumulative_return: "Return",
};

interface PercentileRankBadgeProps {
  metric: string;
  percentile: number | null | undefined;
  categoryLabel?: string;
  className?: string;
  /**
   * 194 D-11 / D-15: the calendar days of record the ranked figure is annualised from, passed
   * ONLY for an annualised metric (CAGR, Sharpe, Sortino, Volatility) of a record that cleared
   * D-15's minimum and spans under one year. The rank then carries the `<1y` marker with its
   * reason in `title` and in sr-only text. Absent or null: the badge renders exactly as before.
   * Never passed for Max DD or Return (not annualised); the caller decides, this only renders.
   */
  shortTrackDays?: number | null;
}

/**
 * Shows a strategy's percentile rank for a given metric, scoped to its
 * discovery category when categoryLabel is provided.
 *
 * Computation lives in `getPercentiles()` in lib/queries.ts — this badge is
 * purely presentational. Renders nothing when percentile is null/undefined
 * (fewer than 5 strategies in the peer set).
 */
export function PercentileRankBadge({
  metric,
  percentile,
  categoryLabel,
  className,
  shortTrackDays,
}: PercentileRankBadgeProps) {
  if (percentile == null || !Number.isFinite(percentile)) return null;

  const metricLabel = PERCENTILE_METRIC_LABELS[metric] ?? metric;
  const suffix = ordinalSuffix(Math.round(percentile));
  const tier = tierFor(percentile);

  const peerText = categoryLabel ? ` in ${categoryLabel}` : "";
  const shortReason = shortTrackDays != null ? shortTrackMarkerTitle(shortTrackDays) : null;

  return (
    <span
      // IMPACT-02 (21-03) — render-only signal for the ScenarioComposer R3
      // neuter guard. The guard asserts NO PercentileRankBadge renders on a
      // hypothetical scenario blend (no false peer-ranking). "percentile" lives
      // only in the title= attribute and the visible labels ("Sharpe", "Max DD")
      // collide with the honest KPI strip, so the guard needs a unique,
      // non-colliding testid. Adds no behavior; changes nothing else.
      data-testid="percentile-rank-badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-0.5 text-fixed-11 font-medium",
        tier === "top" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tier === "high" && "border-accent/30 bg-accent/5 text-accent",
        tier === "mid" && "border-border bg-page text-text-secondary",
        tier === "low" && "border-amber-200 bg-amber-50 text-amber-700",
        className,
      )}
      title={`${metricLabel} is in the ${suffix} percentile${peerText}`}
    >
      <span>{metricLabel}</span>
      <span className="font-semibold">{suffix}</span>
      {shortReason && (
        <span
          title={shortReason}
          className="font-mono text-fixed-10 font-normal tabular-nums text-text-muted"
        >
          {SHORT_TRACK_MARKER}
          <span className="sr-only"> {shortReason}</span>
        </span>
      )}
    </span>
  );
}

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function tierFor(percentile: number): "top" | "high" | "mid" | "low" {
  if (percentile >= 90) return "top";
  if (percentile >= 70) return "high";
  if (percentile >= 40) return "mid";
  return "low";
}
