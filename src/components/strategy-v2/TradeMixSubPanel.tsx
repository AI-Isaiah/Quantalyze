"use client";

import type { TradeMixBuckets } from "@/lib/types";

type TradeMixMode = "2-bucket" | "4-bucket";

interface TradeMixSubPanelProps {
  buckets?: TradeMixBuckets;
  mode?: TradeMixMode;
}

/**
 * Phase 14b-04 / KPI-17 (partial) — Trade Mix sub-panel.
 *
 * Ships 2-bucket Long/Short bar visualization. The `mode='2-bucket' | '4-bucket'`
 * prop is reserved for v0.17.1 maker/taker flip (gated on `is_maker`
 * population fix in `analytics-service/services/exchange.py` for
 * Binance/OKX/Bybit). The 4-bucket render branch is intentionally NOT
 * implemented in 14b — it renders a fallback message so the prop signature
 * is stable across the flip.
 *
 * Visual contract (UI-SPEC §3.3):
 *   - mt-8 border-t border-border pt-6 container
 *   - H3 "Trade mix" (sentence-case) — 12px uppercase tracking-wider muted
 *   - 2 horizontal bars: Long fill CHART_ACCENT, Short fill CHART_TEXT_MUTED
 *     (literal hex values inlined below — see chart-tokens.ts).
 *     Bar height 24px (h-6). Percent label OUTSIDE bar
 *     (right-aligned, 18px Geist Mono semibold tabular-nums).
 *   - Raw count "(1,247 fills)" 12px regular muted next to percent label.
 *   - Empty state: "Trade mix unavailable for this strategy."
 *   - 4-bucket fallback: "4-bucket maker/taker mode is reserved for v0.17.1."
 */
export function TradeMixSubPanel({
  buckets,
  mode = "2-bucket",
}: TradeMixSubPanelProps) {
  if (mode === "4-bucket") {
    // Phase 14b ships 2-bucket only. Maker/taker 4-bucket dimension is
    // descoped to v0.17.1 — gated on `is_maker` flag fix in
    // analytics-service/services/exchange.py for Binance/OKX/Bybit.
    return (
      <div className="mt-8 border-t border-border pt-6">
        <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
          Trade mix
        </h3>
        <p className="text-xs font-normal text-text-muted">
          4-bucket maker/taker mode is reserved for v0.17.1.
        </p>
      </div>
    );
  }

  const longCount = buckets?.long?.count ?? 0;
  const shortCount = buckets?.short?.count ?? 0;
  const total = longCount + shortCount;

  return (
    <div className="mt-8 border-t border-border pt-6">
      <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
        Trade mix
      </h3>
      {total === 0 ? (
        <p className="text-xs font-normal text-text-muted">
          Trade mix unavailable for this strategy.
        </p>
      ) : (
        <div className="space-y-3">
          <BucketBar
            label="Long entries"
            count={longCount}
            total={total}
            fillColor="#1B6B5A"
          />
          <BucketBar
            label="Short entries"
            count={shortCount}
            total={total}
            fillColor="#94A3B8"
          />
        </div>
      )}
    </div>
  );
}

function BucketBar({
  label,
  count,
  total,
  fillColor,
}: {
  label: string;
  count: number;
  total: number;
  fillColor: string;
}) {
  const pct = total === 0 ? 0 : Math.round((count / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 text-xs font-normal text-text-muted">{label}</div>
      <div className="relative h-6 flex-1 rounded-sm bg-surface-subtle">
        <div
          data-trade-mix-bar
          className="h-full rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: fillColor }}
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
