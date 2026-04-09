import { cn, formatPercent } from "@/lib/utils";

/**
 * `<CounterfactualStrip>` — the 5-year-horizon hook below the editorial hero.
 *
 * "Had you allocated 12 months ago: portfolio +X% vs BTC +Y%."
 *
 * Reads the same hero numbers (`portfolio_twr`, `benchmark_twr`) so it never
 * disagrees with the verdict block. If either is missing, render nothing.
 */

export interface CounterfactualStripProps {
  portfolioTwr: number | null;
  benchmarkTwr: number | null;
  benchmarkLabel?: string;
  /** Period descriptor — defaults to "12 months ago" but can be tuned. */
  period?: string;
  className?: string;
}

export function CounterfactualStrip({
  portfolioTwr,
  benchmarkTwr,
  benchmarkLabel = "BTC",
  period = "12 months ago",
  className,
}: CounterfactualStripProps) {
  if (portfolioTwr == null || benchmarkTwr == null) return null;
  return (
    <p
      className={cn(
        "text-sm sm:text-base text-text-secondary",
        className,
      )}
    >
      Had you allocated {period}:{" "}
      <span className="font-metric tabular-nums text-text-primary">
        portfolio {formatPercent(portfolioTwr)}
      </span>{" "}
      vs{" "}
      <span className="font-metric tabular-nums text-text-primary">
        {benchmarkLabel} {formatPercent(benchmarkTwr)}
      </span>
      .
    </p>
  );
}
