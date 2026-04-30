"use client";

import type { TradeMixBuckets } from "@/lib/types";
import { CHART_ACCENT, CHART_TEXT_MUTED } from "@/components/charts/chart-tokens";

interface TradeMixSubPanelProps {
  buckets?: TradeMixBuckets;
  /**
   * True when the strategy has any short positions. Trade Mix maps
   * fill-side buy→long / sell→short, which mis-attributes "buy to close
   * short" as a long entry — accurate for long-only strategies, an
   * approximation for anything that ever shorts.
   */
  approximate?: boolean;
}

/**
 * Trade Mix sub-panel.
 *
 * Auto-detects 2-bucket vs 4-bucket render from the buckets shape:
 *   - 4-bucket when any of long_maker / long_taker / short_maker / short_taker
 *     is present (analytics_runner._compute_trade_mix with TRADE_MIX_HAS_MAKER_TAKER=true)
 *   - 2-bucket fallback when only long / short are present
 *
 * Visual contract:
 *   - mt-8 border-t border-border pt-6 container
 *   - H3 "Trade mix" (sentence-case) — 12px uppercase tracking-wider muted
 *   - Bars: Long fill CHART_ACCENT, Short fill CHART_TEXT_MUTED
 *     (taker bars dim to 60% opacity to differentiate from maker bars)
 *   - Bar height 24px (h-6). Percent label OUTSIDE bar
 *     (right-aligned, 18px Geist Mono semibold tabular-nums).
 *   - Raw count "(1,247 fills)" 12px regular muted next to percent label.
 *   - Empty state: "Trade mix unavailable for this strategy."
 */
export function TradeMixSubPanel({ buckets, approximate }: TradeMixSubPanelProps) {
  const has4Bucket = !!(
    buckets?.long_maker ||
    buckets?.long_taker ||
    buckets?.short_maker ||
    buckets?.short_taker
  );

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xs font-normal uppercase tracking-wider text-text-secondary">
          Trade mix
        </h3>
        {approximate && (
          <span className="text-xs font-normal text-warning">
            Approximate — close-shorts bucketed by fill side
          </span>
        )}
      </div>
      {has4Bucket ? (
        <FourBucketBars buckets={buckets!} />
      ) : (
        <TwoBucketBars buckets={buckets} />
      )}
    </div>
  );
}

function FourBucketBars({ buckets }: { buckets: TradeMixBuckets }) {
  const lm = buckets.long_maker?.count ?? 0;
  const lt = buckets.long_taker?.count ?? 0;
  const sm = buckets.short_maker?.count ?? 0;
  const st = buckets.short_taker?.count ?? 0;
  const total = lm + lt + sm + st;

  if (total === 0) {
    return (
      <p className="text-xs font-normal text-text-muted">
        Trade mix unavailable for this strategy.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <BucketBar label="Long maker" count={lm} total={total} fillColor={CHART_ACCENT} />
      <BucketBar
        label="Long taker"
        count={lt}
        total={total}
        fillColor={CHART_ACCENT}
        fillOpacity={0.6}
      />
      <BucketBar label="Short maker" count={sm} total={total} fillColor={CHART_TEXT_MUTED} />
      <BucketBar
        label="Short taker"
        count={st}
        total={total}
        fillColor={CHART_TEXT_MUTED}
        fillOpacity={0.6}
      />
    </div>
  );
}

function TwoBucketBars({ buckets }: { buckets?: TradeMixBuckets }) {
  const longCount = buckets?.long?.count ?? 0;
  const shortCount = buckets?.short?.count ?? 0;
  const total = longCount + shortCount;

  if (total === 0) {
    return (
      <p className="text-xs font-normal text-text-muted">
        Trade mix unavailable for this strategy.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <BucketBar
        label="Long entries"
        count={longCount}
        total={total}
        fillColor={CHART_ACCENT}
      />
      <BucketBar
        label="Short entries"
        count={shortCount}
        total={total}
        fillColor={CHART_TEXT_MUTED}
      />
    </div>
  );
}

function BucketBar({
  label,
  count,
  total,
  fillColor,
  fillOpacity = 1,
}: {
  label: string;
  count: number;
  total: number;
  fillColor: string;
  fillOpacity?: number;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 text-xs font-normal text-text-muted">{label}</div>
      <div className="relative h-6 flex-1 rounded-sm bg-surface-subtle">
        <div
          data-trade-mix-bar
          className="h-full rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: fillColor, opacity: fillOpacity }}
          aria-hidden="true"
        />
      </div>
      <div
        className="w-32 text-right text-lg font-semibold tabular-nums text-text-primary"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {pct}%
        <span className="ml-2 text-xs font-normal text-text-muted">
          ({count.toLocaleString()} fills)
        </span>
      </div>
    </div>
  );
}
