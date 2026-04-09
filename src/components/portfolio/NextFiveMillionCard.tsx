import { cn, formatCurrency } from "@/lib/utils";
import type { OptimizerSuggestionRow } from "@/lib/types";

/**
 * `<NextFiveMillionCard>` — Moment 3 dollar allocation. Translates the top 3
 * optimizer suggestions into concrete dollar amounts ("If you had $5M to
 * deploy, here's where it goes"). Always renders as a numbered list, never
 * a card grid.
 */

export interface NextFiveMillionCardProps {
  suggestions: OptimizerSuggestionRow[] | null;
  /** How many dollars to allocate. Default $5M. */
  amount?: number;
  className?: string;
}

const DEFAULT_AMOUNT = 5_000_000;

export function NextFiveMillionCard({
  suggestions,
  amount = DEFAULT_AMOUNT,
  className,
}: NextFiveMillionCardProps) {
  if (!suggestions || suggestions.length === 0) return null;
  const top = suggestions.slice(0, 3);
  const totalScore = top.reduce((s, x) => s + Math.max(0, x.score), 0);

  // If every score is zero (or negative), distribute equally.
  const allocations =
    totalScore <= 0
      ? top.map((row) => ({
          row,
          dollars: amount / top.length,
        }))
      : top.map((row) => ({
          row,
          dollars: amount * (Math.max(0, row.score) / totalScore),
        }));

  return (
    <section
      aria-label="Where the next allocation would go"
      className={cn("flex flex-col gap-3", className)}
    >
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        Where would the next {formatCurrency(amount)} go?
      </p>
      <ol className="divide-y divide-border">
        {allocations.map(({ row, dollars }, i) => (
          <li
            key={row.strategy_id}
            className="flex items-baseline justify-between gap-4 py-3"
          >
            <span className="text-sm text-text-primary">
              <span className="text-text-muted mr-2">{i + 1}.</span>
              {row.strategy_name}
            </span>
            <span className="font-metric tabular-nums text-sm text-text-primary">
              {formatCurrency(dollars)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
