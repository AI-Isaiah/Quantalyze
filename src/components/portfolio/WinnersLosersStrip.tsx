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

function Row({ name, contribution }: { name: string; contribution: number }) {
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

function Column({
  heading,
  rows,
  emptyCopy,
}: {
  heading: string;
  rows: AttributionRow[];
  emptyCopy: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
        {heading}
      </p>
      {rows.length > 0 ? (
        <ul role="list" className="divide-y divide-border">
          {rows.map((r) => (
            <Row
              key={r.strategy_id}
              name={r.strategy_name}
              contribution={r.contribution}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-text-muted">{emptyCopy}</p>
      )}
    </div>
  );
}

export function WinnersLosersStrip({
  attribution,
  className,
}: WinnersLosersStripProps) {
  const { winners, losers } = computeWinnersLosers(attribution, { count: 3 });
  // Editorial /demo policy: strips NEVER unmount, only their content does.
  // Returning null used to cause layout shift when attribution was null or
  // all-zero; the strip now always renders with fallback copy in both
  // columns so the page height is stable across reloads.
  const waiting = attribution == null || attribution.length === 0;
  const winnersEmpty = waiting
    ? "Waiting for the first attribution run."
    : "No positive contributors yet.";
  const losersEmpty = waiting
    ? "Waiting for the first attribution run."
    : "No detractors this period.";

  return (
    <section
      aria-label="Winners and losers"
      className={cn("grid gap-6 sm:grid-cols-2", className)}
    >
      <Column
        heading="Top contributors"
        rows={winners}
        emptyCopy={winnersEmpty}
      />
      <Column
        heading="Top detractors"
        rows={losers}
        emptyCopy={losersEmpty}
      />
    </section>
  );
}
