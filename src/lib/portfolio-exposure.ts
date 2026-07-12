/**
 * Portfolio exposure read layer — PI-01 / PI-02 / PI-03 (Phase 98, v1.10).
 *
 * A server-only, owner-scoped, secretless read over `allocator_holdings` that
 * gives Phase 99's three widgets their data WITHOUT any UI or ingestion (both
 * explicitly deferred): Exposure by Asset Class (PI-01), Net Exposure Over Time
 * (PI-02), Allocation Over Time (PI-03). This module is the contract Phase 99
 * renders against — the decisions below are LOCKED by the 98-03 planner; read
 * them before consuming.
 *
 * D-P1 — Exposure taxonomy. `holding_type` (`spot` | `derivative`) is the
 *   PRIMARY class dimension and the only complete, honest, non-degenerate
 *   per-position class that EXISTS in this table. `allocator_holdings.venue` is
 *   always a crypto exchange (custody location, not an asset class), so the
 *   #597 crypto/traditional classifier is degenerate here; `symbol` is too
 *   granular to be a class and any symbol->bucket map would be invented
 *   taxonomy. The snapshot therefore returns slices at the raw groupable
 *   (holding_type, venue, symbol, side) grain with `holding_type` designated
 *   primary; the DISPLAY LABEL (e.g. "Spot vs Derivatives") is Phase 99's call.
 *   venue/symbol travel along for secondary grouping / drill-down.
 *
 * D-P2 — Net exposure is SIGNED. `value_usd` is stored UNSIGNED (magnitude);
 *   direction lives in `side`. `signedValueUsd = side === "short" ? -value_usd
 *   : value_usd`; `netUsd = sum(signed)`, `grossUsd = sum(value_usd)`. A hedged
 *   book (long 300 + short 100) reads net 200 / gross 400 — summing unsigned
 *   notional and calling it "net" would misstate it. Both are returned.
 *
 * D-P3 — Allocation-over-time weights are per-VENUE. `allocator_holdings` has
 *   NO strategy linkage (its only FK points at the api-keys table), so
 *   "per-strategy weight"
 *   does not exist; CONTEXT's "per-strategy (or per-venue)" resolves to venue.
 *   `weight = venueGrossUsd / asofTotalGrossUsd` per `asof` (GROSS denominators
 *   — signed values can divide by ~0 on a hedged book). An `asof` whose total
 *   gross is 0 cannot form honest weights: it is SKIPPED (emits no point) and
 *   thereby falls into a marked gap rather than producing NaN weights.
 *
 * D-P7 / honest-empty. `getLatestExposureSnapshot` returns `null` when the
 *   allocator has zero holdings (so "no data" is distinguishable from "zero
 *   exposure"); the two series return `{ points: [], gaps: [] }`. Never a
 *   zero-filled point, never a synthetic `asof`.
 *
 * No-zero-fill / marked gaps. `asof` is a plain DATE (one row per
 *   allocator/venue/symbol/day). A calendar day missing strictly between the
 *   first and last observed `asof` is a `{ start, end, kind: "gap", days }`
 *   span (days inclusive both ends), mirroring the factsheet `missingSegments`
 *   convention (src/lib/factsheet/types.ts:472-478). Points are emitted ONLY
 *   for asof days that exist; gaps are marked, never synthesized.
 *
 * Trust boundary (T-98-07 / T-98-08). Reads run under the USER Supabase client
 *   (owner RLS: `allocator_holdings_owner_select` — `allocator_id =
 *   auth.uid()`) with an explicit `.eq("allocator_id", userId)` gate as
 *   defence-in-depth. The admin client is NEVER imported (it would bypass RLS).
 *   The projection is a six-column allow-list; the exchange raw-payload column
 *   and the key-material columns are never selected.
 *
 * Edge case (98-03 plan-checker W4). The fetch caps rows at 730 days via
 *   `.gte("asof", today - 730d)`, mirroring the reconstruction BACKFILL_CAP_DAYS
 *   (queries.ts:2540-2542). An allocator whose most recent holdings snapshot is
 *   >730 days stale therefore reads as honest-empty ("no data") rather than
 *   surfacing a two-year-old exposure. This is acceptable (a >2y-stale
 *   allocator has no current exposure to report) but is documented here so a
 *   future consumer knows stale-beyond-cap is indistinguishable from empty.
 */

import { createClient } from "@/lib/supabase/server";

const BACKFILL_CAP_DAYS = 730;
const MS_PER_DAY = 86_400_000;

export type HoldingClass = "spot" | "derivative";

export interface ExposureSlice {
  holdingType: HoldingClass;
  venue: string;
  symbol: string;
  side: "long" | "short" | "flat";
  /** Unsigned, as stored. */
  valueUsd: number;
  /** D-P2: short => -valueUsd. */
  signedValueUsd: number;
}

export interface ExposureSnapshot {
  /** The latest asof the slices belong to. */
  asof: string;
  slices: ExposureSlice[];
  totalGrossUsd: number;
  totalNetUsd: number;
}

export interface AsofGap {
  start: string;
  end: string;
  kind: "gap";
  days: number;
}

export interface NetExposurePoint {
  asof: string;
  netUsd: number;
  grossUsd: number;
}

export interface AllocationPoint {
  asof: string;
  /** Weights sum to 1 per point (gross denominators). */
  venues: { venue: string; valueUsd: number; weight: number }[];
}

/** One row of the six-column allow-listed projection. */
interface HoldingRow {
  asof: string;
  venue: string;
  symbol: string;
  holding_type: string;
  side: string;
  value_usd: number;
}

/** D-P2: negate short notional; long/flat pass through unsigned. */
function signed(side: string, valueUsd: number): number {
  return side === "short" ? -valueUsd : valueUsd;
}

/** Parse a plain "YYYY-MM-DD" DATE to a UTC epoch-ms at midnight (no TZ drift). */
function utcMs(asof: string): number {
  const [y, m, d] = asof.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Format a UTC epoch-ms back to a plain "YYYY-MM-DD" DATE. */
function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Pure gap detector over the DISTINCT, ascending-sorted `asof` days. Emits one
 * `{ start, end, kind: "gap", days }` span per interior calendar hole (days
 * inclusive both ends), mirroring the factsheet missingSegments shape. UTC
 * arithmetic keeps day boundaries stable regardless of the host timezone.
 * Fewer than two days (or all-consecutive days) yields `[]`.
 */
export function computeAsofGaps(sortedAsofDays: string[]): AsofGap[] {
  const gaps: AsofGap[] = [];
  for (let i = 1; i < sortedAsofDays.length; i++) {
    const prevMs = utcMs(sortedAsofDays[i - 1]);
    const curMs = utcMs(sortedAsofDays[i]);
    const missing = Math.round((curMs - prevMs) / MS_PER_DAY) - 1;
    if (missing > 0) {
      gaps.push({
        start: toIsoDate(prevMs + MS_PER_DAY),
        end: toIsoDate(curMs - MS_PER_DAY),
        kind: "gap",
        days: missing,
      });
    }
  }
  return gaps;
}

/**
 * The ONE owner-scoped fetch: USER client + owner RLS, explicit allocator gate,
 * six-column secretless projection, 730-day cap, ascending by asof. Throws on a
 * PostgREST error (fail loud — an empty result and a query error are distinct
 * states; never collapse an error into `[]`).
 */
async function fetchHoldings(userId: string): Promise<HoldingRow[]> {
  const supabase = await createClient();
  const capIso = toIsoDate(Date.now() - BACKFILL_CAP_DAYS * MS_PER_DAY);
  const { data, error } = await supabase
    .from("allocator_holdings")
    .select("asof, venue, symbol, holding_type, side, value_usd")
    .eq("allocator_id", userId)
    .gte("asof", capIso)
    .order("asof", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HoldingRow[];
}

/** Distinct asof days in ascending order. */
function distinctSortedAsofs(rows: HoldingRow[]): string[] {
  return Array.from(new Set(rows.map((r) => r.asof))).sort();
}

/**
 * PI-01 — the allocator's LATEST exposure, aggregated at the
 * (holding_type, venue, symbol, side) grain with gross + signed net totals.
 * Returns `null` for an allocator with zero holdings (honest-empty).
 */
export async function getLatestExposureSnapshot(
  userId: string,
): Promise<ExposureSnapshot | null> {
  const rows = await fetchHoldings(userId);
  if (rows.length === 0) return null;

  const latestAsof = rows.reduce(
    (max, r) => (r.asof > max ? r.asof : max),
    rows[0].asof,
  );
  const latestRows = rows.filter((r) => r.asof === latestAsof);

  const byGrain = new Map<string, ExposureSlice>();
  for (const r of latestRows) {
    const key = `${r.holding_type}|${r.venue}|${r.symbol}|${r.side}`;
    const existing = byGrain.get(key);
    if (existing) {
      existing.valueUsd += r.value_usd;
      existing.signedValueUsd += signed(r.side, r.value_usd);
    } else {
      byGrain.set(key, {
        holdingType: r.holding_type as HoldingClass,
        venue: r.venue,
        symbol: r.symbol,
        side: r.side as ExposureSlice["side"],
        valueUsd: r.value_usd,
        signedValueUsd: signed(r.side, r.value_usd),
      });
    }
  }

  const slices = Array.from(byGrain.values());
  const totalGrossUsd = slices.reduce((a, s) => a + s.valueUsd, 0);
  const totalNetUsd = slices.reduce((a, s) => a + s.signedValueUsd, 0);
  return { asof: latestAsof, slices, totalGrossUsd, totalNetUsd };
}

/**
 * PI-02 — signed net (+ gross) exposure per existing `asof` day, with interior
 * calendar holes MARKED as gaps. Never zero-fills a missing day.
 */
export async function getNetExposureSeries(
  userId: string,
): Promise<{ points: NetExposurePoint[]; gaps: AsofGap[] }> {
  const rows = await fetchHoldings(userId);
  if (rows.length === 0) return { points: [], gaps: [] };

  const byAsof = new Map<string, { netUsd: number; grossUsd: number }>();
  for (const r of rows) {
    const acc = byAsof.get(r.asof) ?? { netUsd: 0, grossUsd: 0 };
    acc.netUsd += signed(r.side, r.value_usd);
    acc.grossUsd += r.value_usd;
    byAsof.set(r.asof, acc);
  }

  const asofs = distinctSortedAsofs(rows);
  const points: NetExposurePoint[] = asofs.map((asof) => {
    const acc = byAsof.get(asof)!;
    return { asof, netUsd: acc.netUsd, grossUsd: acc.grossUsd };
  });
  return { points, gaps: computeAsofGaps(asofs) };
}

/**
 * PI-03 — per-venue allocation weights per `asof` (gross denominators). An asof
 * whose total gross is 0 is skipped (D-P3) and thereby falls into a marked gap;
 * gaps are computed over the asof days that actually produced points.
 */
export async function getAllocationSeries(
  userId: string,
): Promise<{ points: AllocationPoint[]; gaps: AsofGap[] }> {
  const rows = await fetchHoldings(userId);
  if (rows.length === 0) return { points: [], gaps: [] };

  const byAsof = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const venueGross = byAsof.get(r.asof) ?? new Map<string, number>();
    venueGross.set(r.venue, (venueGross.get(r.venue) ?? 0) + r.value_usd);
    byAsof.set(r.asof, venueGross);
  }

  const points: AllocationPoint[] = [];
  for (const asof of distinctSortedAsofs(rows)) {
    const venueGross = byAsof.get(asof)!;
    const total = Array.from(venueGross.values()).reduce((a, v) => a + v, 0);
    if (total <= 0) continue; // zero-gross asof — skip, becomes a marked gap
    const venues = Array.from(venueGross.entries()).map(([venue, valueUsd]) => ({
      venue,
      valueUsd,
      weight: valueUsd / total,
    }));
    points.push({ asof, venues });
  }

  return { points, gaps: computeAsofGaps(points.map((p) => p.asof)) };
}
