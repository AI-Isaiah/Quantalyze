import { PercentileRankBadge } from "@/components/strategy/PercentileRankBadge";
import { gateAnnualized, type FigureRecord } from "@/lib/figure-gate";
import type { PercentileMetric } from "@/lib/percentile-core";

/** The five ranks the tear sheet has always printed, in print order. */
const RANKED_METRICS = ["cagr", "sharpe", "sortino", "max_drawdown", "volatility"] as const satisfies readonly PercentileMetric[];

/**
 * The one peer-relative rank block: the tear sheet prints it, and Advanced on the
 * factsheet mounts the same component (Phase 196 plan 16). Extracted verbatim from
 * the HEAD tear sheet so a rank keeps the gate it had.
 *
 * Presentational only, no data access: the caller reads `getPercentiles(categorySlug)`
 * and hands this strategy's entry in. It renders `PercentileRankBadge`, never the
 * factsheet's metric `Row`, so the figure census does not count a rank as a metric.
 *
 * The gate (194 D-15, D-18, review WR-01): the four annualised ranks go with the
 * annualised figures beside them. A withheld record, or one that could not be read
 * (`record` null: no record fails closed), drops them; a record under a year keeps
 * them and carries `<1y`. Max DD is not annualised and is always ranked.
 *
 * Empty-section rule (Phase 196 D-04): when no badge would render the section is
 * absent, not a bare heading. HEAD printed the heading over nothing.
 */
export function PeerRanksSection({
  percentiles,
  categoryLabel,
  record,
}: {
  /** This strategy's entry from the `getPercentiles` map, or null when it has none. */
  percentiles: PeerPercentiles | null;
  categoryLabel?: string;
  /** The payload's `figureRecord`; null when unreadable. */
  record: FigureRecord | null;
}) {
  const badges = peerRankBadges(percentiles, record);
  if (badges.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-text-primary">Peer-relative ranks</h2>
      <div className="flex flex-wrap gap-2">
        {badges.map((b) => (
          <PercentileRankBadge
            key={b.metric}
            metric={b.metric}
            percentile={b.percentile}
            categoryLabel={categoryLabel}
            shortTrackDays={b.shortTrackDays}
          />
        ))}
      </div>
    </section>
  );
}

type PeerPercentiles = Partial<Record<PercentileMetric, number | null>>;

/** The badges that would render, after the 194 gate. The one place the gate is applied. */
function peerRankBadges(percentiles: PeerPercentiles | null, record: FigureRecord | null) {
  if (!percentiles) return [];
  const gateState = record ? gateAnnualized(record) : "withheld";
  return RANKED_METRICS.map((metric) => {
    const annualised = metric !== "max_drawdown";
    const percentile = annualised && gateState === "withheld" ? null : percentiles[metric];
    return {
      metric,
      percentile,
      shortTrackDays: annualised && gateState === "short" ? record?.spanDays : null,
    };
  }).filter((b) => b.percentile != null && Number.isFinite(b.percentile));
}

/**
 * Would `PeerRanksSection` draw anything? The predicate the component applies before rendering,
 * exported so the factsheet's Advanced can count the section as rail content (D-04: an Advanced
 * holding only the ranks still renders). The component calls the same helper, so the two cannot
 * disagree.
 */
export function hasPeerRanks(percentiles: PeerPercentiles | null, record: FigureRecord | null): boolean {
  return peerRankBadges(percentiles, record).length > 0;
}
