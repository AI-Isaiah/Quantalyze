import { cn, formatPercent } from "@/lib/utils";
import type { AttributionRow } from "@/lib/types";
import { computeWinnersLosers } from "@/lib/winners-losers";

/**
 * `<WinnersLosersStrip>` — top contributors and bottom detractors as a tight
 * 6-row strip on /demo. Strategy name + signed contribution, mono numbers,
 * no color bars.
 *
 * The CEO + design reviews demoted this from "Hero Row card" to "below the
 * evidence panel" because the editorial hero already carries the verdict;
 * this strip is supporting evidence, not headline.
 */

export interface WinnersLosersStripProps {
  attribution: AttributionRow[] | null;
  className?: string;
}

function Row({
  name,
  contribution,
}: {
  name: string;
  contribution: number;
}) {
  const positive = contribution >= 0;
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-sm text-text-primary truncate">{name}</span>
      <span
        className={cn(
          "font-metric tabular-nums text-sm",
          positive ? "text-positive" : "text-negative",
        )}
      >
        {formatPercent(contribution)}
      </span>
    </li>
  );
}

export function WinnersLosersStrip({
  attribution,
  className,
}: WinnersLosersStripProps) {
  const { winners, losers } = computeWinnersLosers(attribution, { count: 3 });
  const hasAny = winners.length > 0 || losers.length > 0;
  if (!hasAny) return null;

  return (
    <section
      aria-label="Winners and losers"
      className={cn("grid gap-6 sm:grid-cols-2", className)}
    >
      <div>
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
          Top contributors
        </p>
        {winners.length > 0 ? (
          <ul role="list" className="divide-y divide-border">
            {winners.map((w) => (
              <Row
                key={w.strategy_id}
                name={w.strategy_name}
                contribution={w.contribution}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No positive contributors yet.</p>
        )}
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
          Top detractors
        </p>
        {losers.length > 0 ? (
          <ul role="list" className="divide-y divide-border">
            {losers.map((l) => (
              <Row
                key={l.strategy_id}
                name={l.strategy_name}
                contribution={l.contribution}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-muted">No detractors this period.</p>
        )}
      </div>
    </section>
  );
}
