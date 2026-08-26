import { Badge } from "@/components/ui/Badge";
import { SyncBadge } from "./SyncBadge";
import { TrustTierLabel } from "./TrustTierLabel";
import { displayStrategyName } from "@/lib/strategy-display";
import type { Strategy } from "@/lib/types";

export function StrategyHeader({
  strategy,
  computedAt,
}: {
  strategy: Strategy;
  computedAt?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-fixed-32 font-bold tracking-tight text-text-primary">
          {displayStrategyName(strategy)}
        </h1>
        {/* Phase 15 / CSV-03: csv_uploaded only renders text; other tiers
            return null. Phase 17 / DESIGN-01 swaps to a polished pill
            without changing this call signature. */}
        <TrustTierLabel trustTier={strategy.trust_tier} />
        <Badge label={strategy.status} type="status" />
      </div>
      <div className="flex items-center gap-3">
        {computedAt && (
          <SyncBadge
            computedAt={computedAt}
            /* HONEST-08 — EXPLICIT null. This header takes a `Strategy` and a
               bare `computedAt` string; it is handed no analytics row and
               therefore no series end. Passing null buys the conservative
               capping (the dot cannot claim "fresh") rather than a freshness
               claim this component has no evidence for. Widening the props to
               carry the series is the fix if this surface ever needs the
               track-record arm. */
            seriesEnd={null}
            exchange={strategy.supported_exchanges?.[0]}
          />
        )}
        {strategy.start_date && (
          <span className="text-xs text-text-muted">
            Live since {strategy.start_date}
          </span>
        )}
      </div>
    </div>
  );
}
