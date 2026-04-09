import { cn, formatPercent } from "@/lib/utils";
import type { OptimizerSuggestionRow } from "@/lib/types";

/**
 * `<WhatWedDoCard>` — Moment 3 narrative ("what we'd do in your shoes").
 *
 * Reads the top optimizer suggestion and reframes it as 2 sentences with
 * an explicit expected outcome. If `optimizer_suggestions` is empty or null,
 * the card is hidden entirely.
 */

export interface WhatWedDoCardProps {
  suggestions: OptimizerSuggestionRow[] | null;
  className?: string;
}

export function WhatWedDoCard({ suggestions, className }: WhatWedDoCardProps) {
  if (!suggestions || suggestions.length === 0) return null;
  const top = suggestions[0];

  // Don't recommend a strategy that would make the portfolio worse. A
  // negative sharpe_lift OR a non-finite score means the optimizer has
  // nothing useful to say — hide the entire card rather than render a
  // contradictory sentence.
  if (
    !Number.isFinite(top.score) ||
    !Number.isFinite(top.sharpe_lift) ||
    top.sharpe_lift < 0
  ) {
    return null;
  }

  // Order of operations: Sharpe lift is the primary win; corr reduction is
  // the diversification framing; dd improvement is the safety framing.
  const sharpeLine =
    top.sharpe_lift > 0
      ? `lift Sharpe by ${formatPercent(top.sharpe_lift)}`
      : null;
  const corrLine =
    top.corr_with_portfolio < 0.3
      ? `reduce average correlation toward ${top.corr_with_portfolio.toFixed(2)}`
      : null;
  const ddLine =
    top.dd_improvement > 0
      ? `improve drawdown by ${formatPercent(top.dd_improvement)}`
      : null;
  const wins = [sharpeLine, corrLine, ddLine].filter((s): s is string => s !== null);
  const why = wins.length > 0 ? wins.join(", ") : "diversify the portfolio";

  return (
    <section
      aria-label="What we would do"
      className={cn("flex flex-col gap-3", className)}
    >
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        What we&apos;d do in your shoes
      </p>
      <p className="text-sm sm:text-base text-text-secondary leading-relaxed max-w-2xl">
        Add{" "}
        <span className="font-medium text-text-primary">{top.strategy_name}</span>{" "}
        at a 10% allocation to {why}. Optimizer score {top.score.toFixed(2)} on the
        latest run.
      </p>
    </section>
  );
}
