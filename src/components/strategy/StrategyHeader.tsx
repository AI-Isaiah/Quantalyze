import { Badge } from "@/components/ui/Badge";
import { SyncBadge } from "./SyncBadge";
import { TrustTierLabel } from "./TrustTierLabel";
import { displayStrategyName } from "@/lib/strategy-display";
import type { Strategy } from "@/lib/types";

/**
 * ⛔ THIS COMPONENT IS NOT MOUNTED ANYWHERE (163-REVIEW / IN-01, measured
 * 2026-08-26). `grep -rn "StrategyHeader" src/` returns its own definition,
 * its own test file, and three stale prose references that name it as a live
 * caller — `ui/Badge.tsx:21`, `ui/Badge.test.tsx:9` and
 * `strategy/TrustTierLabel.tsx:47`. There is no import of it from any page,
 * layout or component. Nothing here reaches a user.
 *
 * RECORDED, NOT DELETED. Deletion is the right end state and is booked rather
 * than done: it also removes `StrategyHeader.test.tsx`, which is outside the
 * scope of the review fix that discovered this, and those three stale comments
 * should be corrected in the same pass so the next reader is not sent looking
 * for a caller that does not exist.
 *
 * ⚠️ WHY IT MATTERS BEYOND TIDINESS. `163-04-SUMMARY.md` counts this file
 * among "all five real SyncBadge mounts". There are four. The `seriesEnd={null}`
 * decision below — and the permanent amber capping it buys — is a real
 * decision about an unreal surface, so it is evidence of nothing: it can
 * neither confirm nor regress HONEST-08. Any future audit of SyncBadge mount
 * coverage must discount this file, which is exactly the mistake the SUMMARY
 * made once already.
 */
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
