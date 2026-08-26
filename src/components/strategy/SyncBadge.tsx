import { cn } from "@/lib/utils";
import {
  resolveEffectiveRecency,
  FRESHNESS_COLORS,
  CLOCK_SKEW_TOLERANCE_MINUTES,
} from "@/lib/freshness";

interface SyncBadgeProps {
  computedAt: string | null;
  /**
   * Phase 163 / HONEST-08 — the date of the LAST point of the strategy's
   * return series, or `null` when this surface cannot resolve one.
   *
   * REQUIRED, deliberately. Every mount is compile-forced into an explicit
   * decision about whether it can answer "where does the track record end",
   * because the defect this prop closes was precisely a surface answering a
   * question it had no data for. An optional prop would let a future mount
   * silently reopen the class by omission.
   */
  seriesEnd: string | null;
  exchange?: string | null;
  className?: string;
}

/**
 * ⚠️ THE FUTURE ARM IS LOAD-BEARING (163-REVIEW / WR-06). Without it a
 * negative age falls straight through `seconds < 60` and this function calls a
 * date that HAS NOT HAPPENED "just now" — so the badge rendered a red dot
 * beside "Track record ends just now", stating a catastrophe and a triviality
 * about one date in one span. The colour was fixed in `bucketSeriesAge`; the
 * SENTENCE has to stop lying too, or the contradiction merely moves.
 *
 * ⛔ THE THRESHOLD IS NOT ZERO, DELIBERATELY. `computeFreshness` has always
 * tolerated up to `CLOCK_SKEW_TOLERANCE_MINUTES` of writer/reader drift as
 * `fresh`, and a browser clock trailing the server's by a second or two is
 * ordinary rather than corrupt. Announcing "in the future" on that drift would
 * fire on real users AND would contradict the green dot rendered from the same
 * instant — trading WR-06's self-contradiction for a fresh one. The copy and
 * the colour read ONE tolerance, imported rather than re-typed.
 */
function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < -CLOCK_SKEW_TOLERANCE_MINUTES * 60) return "in the future";
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const EXCHANGE_LABELS: Record<string, string> = {
  binance: "Binance",
  okx: "OKX",
  bybit: "Bybit",
};

/**
 * Per-row data-recency badge for the ranked lists and the portfolio tables.
 *
 * Phase 163 / HONEST-08 (measured on production 2026-08-26) — THE BADGE
 * BUCKETS ON THE STALER OF TWO FACTS: when the analytics job last RAN
 * (`computedAt`) and where the TRACK RECORD ends (`seriesEnd`). Before this it
 * read `computedAt` alone, so `/browse/crypto-sma` row #2 rendered "Synced 7h
 * ago" over a return series whose last point was 112 days old — while that
 * same strategy's factsheet chip correctly read `Track record · old`. Both
 * statements were true and the pair was a lie: "Synced" is a claim about the
 * JOB and every reader takes it as a claim about the STRATEGY.
 *
 * THE BADGE IS NOT DELETED, and that was the tempting wrong fix. Sync recency
 * is real information — it is what tells an operator the pipeline is alive.
 * The defect was presenting it as the ONLY clock. So the staler fact wins, and
 * the copy NAMES whichever subject carried the verdict (mirroring
 * `FreshnessChip`'s `Computed · …` / `Track record · …` eyebrow): a stale dot
 * beside "Synced 7h ago" would merely relocate the contradiction inside the
 * badge. When SYNC binds — every healthy row, and every row that was already
 * honest — the render is unchanged.
 *
 * The staler-of-two decision itself lives in `resolveEffectiveRecency`
 * (lib/freshness.ts), shared with nothing re-derived here. A second local copy
 * of that comparison is exactly how the list and the factsheet came to
 * disagree in the first place.
 */
export function SyncBadge({
  computedAt,
  seriesEnd,
  exchange,
  className,
}: SyncBadgeProps) {
  if (!computedAt) return null;

  const date = new Date(computedAt);
  // The whole staler-of-two decision — which fact binds, and how bad it is —
  // is made in lib/freshness.ts and merely RENDERED here. This component owns
  // no second opinion about which of the two dates is worse; that duplication
  // is what let this surface and the factsheet chip contradict each other.
  const recency = resolveEffectiveRecency(computedAt, seriesEnd);
  const dotColor = FRESHNESS_COLORS[recency.freshness].dot;
  const exchangeLabel = exchange
    ? EXCHANGE_LABELS[exchange.toLowerCase()] ?? exchange
    : null;
  const seriesBinds = recency.subject === "series" && recency.seriesEndDate;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-fixed-10 text-text-muted",
        className,
      )}
      // Only on the series arm, so the sync-keyed render stays byte-identical.
      // The sync date is not DISCARDED when the series binds — it moves here,
      // because "when did we last poll" remains a real fact about the row.
      title={
        seriesBinds
          ? `Track record ends ${timeAgo(recency.seriesEndDate!)}. Analytics last computed ${timeAgo(date)}.`
          : undefined
      }
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dotColor)} />
      {exchangeLabel ? (
        <span className="font-medium text-text-secondary">{exchangeLabel}</span>
      ) : null}
      {seriesBinds ? (
        <span>Track record ends {timeAgo(recency.seriesEndDate!)}</span>
      ) : (
        <span>Synced {timeAgo(date)}</span>
      )}
    </span>
  );
}
