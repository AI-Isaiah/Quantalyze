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
  //
  // 166.1 D7 (founder 2026-09-26): a null sharpe_lift or corr_with_portfolio
  // means the statistic does not exist (the portfolio or the candidate does
  // not disperse). It is not a negative lift, so it does not hide the card; it
  // only drops the sentence that would have quoted it. A null correlation
  // printed "reduce average correlation toward 0.00" before, when the adapter
  // coerced it to 0.
  const lift = top.sharpe_lift;
  const corr = top.corr_with_portfolio;
  if (
    !Number.isFinite(top.score) ||
    (lift !== null && (!Number.isFinite(lift) || lift < 0))
  ) {
    return null;
  }

  // Order of operations: Sharpe lift is the primary win; corr reduction is
  // the diversification framing; dd improvement is the safety framing.
  const sharpeLine =
    lift !== null && lift > 0
      ? `lift Sharpe by ${formatPercent(lift)}`
      : null;
  const corrLine =
    corr !== null && Number.isFinite(corr) && corr < 0.3
      ? `reduce average correlation toward ${corr.toFixed(2)}`
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
      <p className="text-micro uppercase tracking-wider text-text-muted font-medium">
        What we&apos;d do in your shoes
      </p>
      <p className="text-small sm:text-body text-text-secondary leading-relaxed max-w-2xl">
        Add{" "}
        <span className="font-medium text-text-primary">{top.strategy_name}</span>{" "}
        at a 10% allocation to {why}. Optimizer score {top.score.toFixed(2)} on the
        latest run.
      </p>
    </section>
  );
}
