import { cn } from "@/lib/utils";

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
}: PercentileRankBadgeProps) {
  if (percentile == null || !Number.isFinite(percentile)) return null;

  const metricLabel = PERCENTILE_METRIC_LABELS[metric] ?? metric;
  const suffix = ordinalSuffix(Math.round(percentile));
  const tier = tierFor(percentile);

  const peerText = categoryLabel ? ` in ${categoryLabel}` : "";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        tier === "top" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tier === "high" && "border-sky-200 bg-sky-50 text-sky-700",
        tier === "mid" && "border-border bg-page text-text-secondary",
        tier === "low" && "border-amber-200 bg-amber-50 text-amber-700",
        className,
      )}
      title={`${metricLabel} is in the ${suffix} percentile${peerText}`}
    >
      <span>{metricLabel}</span>
      <span className="font-semibold">{suffix}</span>
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
