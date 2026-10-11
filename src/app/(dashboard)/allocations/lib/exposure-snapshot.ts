/**
 * Phase 170.4 plan 01 (D-01, D-08) — the Exposure card's "what I hold now",
 * built from the dashboard payload's per-key holdings rows.
 *
 * WHY THIS IS A PURE BUILDER OVER THE PAYLOAD. Holdings and Open Positions split
 * one `holdingsSummary` array by `holding_type`; that array comes from
 * `fetchLatestHoldingsPerKey`, which drops a key at a newer `native_unpriced`
 * marker, at a newer clean poll and at a newer key on the same exchange account.
 * The Exposure card used to read the allocator's single latest `asof` through a
 * second query that applied only the first rule, so it could show positions the
 * two tables had dropped (PROD, 2026-10-03: 185.1K gross on Exposure, empty
 * Holdings). Building the card from the same array makes the three surfaces
 * agree by construction, with no second copy of the supersession rules.
 *
 * Aggregation grain is (api_key_id, holding_type, venue, symbol, side) and never
 * merges two keys (D-08: one key is one strategy), so the card's gross equals
 * the sum over keys. Net is SIGNED (D-P2): a short is negated, long and flat
 * pass through. An empty book is `null`, never a zero-filled snapshot (D-P7).
 *
 * Pure and client-safe: the data-contract types come in TYPE-ONLY, there is no
 * Supabase client and no table name here (T-170.4-03).
 */

import type { ExposureSlice, ExposureSnapshot } from "@/lib/portfolio-exposure";
import type { MyAllocationDashboardPayload } from "@/lib/queries";

type PayloadHolding = MyAllocationDashboardPayload["holdingsSummary"][number];

/** The columns the card reads, so a caller may pass the full payload rows. */
export type ExposureHoldingRow = Pick<
  PayloadHolding,
  "api_key_id" | "venue" | "symbol" | "holding_type" | "side" | "value_usd" | "asof"
>;

/** D-P2: negate short notional; long/flat pass through unsigned. */
function signed(side: ExposureSlice["side"], valueUsd: number): number {
  return side === "short" ? -valueUsd : valueUsd;
}

export function exposureSnapshotFromHoldings(
  rows: ReadonlyArray<ExposureHoldingRow>,
): ExposureSnapshot | null {
  if (rows.length === 0) return null;

  const byGrain = new Map<string, ExposureSlice>();
  let newest: string | null = null;
  let oldest: string | null = null;
  for (const r of rows) {
    const side: ExposureSlice["side"] = r.side ?? "flat";
    const key = `${r.api_key_id}|${r.holding_type}|${r.venue}|${r.symbol}|${side}`;
    const existing = byGrain.get(key);
    if (existing) {
      existing.valueUsd += r.value_usd;
      existing.signedValueUsd += signed(side, r.value_usd);
    } else {
      byGrain.set(key, {
        apiKeyId: r.api_key_id,
        holdingType: r.holding_type,
        venue: r.venue,
        symbol: r.symbol,
        side,
        valueUsd: r.value_usd,
        signedValueUsd: signed(side, r.value_usd),
      });
    }
    if (typeof r.asof === "string") {
      if (newest === null || r.asof > newest) newest = r.asof;
      if (oldest === null || r.asof < oldest) oldest = r.asof;
    }
  }

  const slices = Array.from(byGrain.values());
  return {
    asof: newest,
    oldestAsof: oldest,
    slices,
    totalGrossUsd: slices.reduce((a, s) => a + s.valueUsd, 0),
    totalNetUsd: slices.reduce((a, s) => a + s.signedValueUsd, 0),
  };
}
