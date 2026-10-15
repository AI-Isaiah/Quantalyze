/**
 * Phase 09 / D-15 + LIVE-03 + findings f6 (charset) + g4 (render branch).
 * /compare parser extension for holding ids.
 *
 * Detects "holding:{venue}:{symbol}:{holding_type}" prefix BEFORE the
 * strategies .in("id", ids) fetch per RESEARCH Pitfall 8. Validates that
 * each of venue / symbol / holding_type matches /^[A-Za-z0-9_-]+$/ per
 * finding f6 — enforcing the Phase 08 D-08 scope_ref invariant that
 * notes + audit entity_id rely on. Holding-side access is RLS-gated on
 * allocator_holdings (policy allocator_holdings_owner_select) — unauthorized
 * reads return zero rows which we surface as a generic "not available"
 * message with no existence leak.
 *
 * Phase 167.1.1 / D-03 (founder, 2026-10-15): the metrics are computed from the
 * holding's daily MARK PRICE (`allocator_holdings.mark_price`, one price per
 * `asof` day), never from its dollar value, so buying, selling or moving more
 * of an asset is not read as a gain or loss. They no longer mirror the
 * dollar-ratio `reconstruct_symbol_returns` in
 * analytics-service/services/equity_reconstruction.py (see
 * `holdingCompareHistoryState` for what stays deferred).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { annualizationPeriods, isCryptoExchange } from "@/lib/closed-sets";
import { HoldingsUpdatedAtError, writtenAtMicros } from "@/lib/holdings-account-day";
import { dispersion, sharpe as returnStatsSharpe } from "@/lib/return-stats";

export type ParsedHoldingCompareId = {
  venue: string;
  symbol: string;
  holding_type: string;
};

/** Charset invariant per Phase 08 D-08 / finding f6. */
const SAFE_PART = /^[A-Za-z0-9_-]+$/;

/**
 * Parse a holding compare id of the form "holding:{venue}:{symbol}:{holding_type}".
 *
 * Returns null when:
 * - id does not start with "holding:"
 * - parts count after the prefix is not exactly 3
 * - any part is empty
 * - any part contains characters outside /^[A-Za-z0-9_-]+$/ (finding f6)
 */
export function parseHoldingCompareId(id: string): ParsedHoldingCompareId | null {
  if (!id || typeof id !== "string") return null;
  if (!id.startsWith("holding:")) return null;
  const parts = id.slice("holding:".length).split(":");
  if (parts.length !== 3) return null;
  const [venue, symbol, holding_type] = parts;
  if (!venue || !symbol || !holding_type) return null;
  // Finding f6: enforce Phase 08 D-08 scope_ref charset invariant.
  // Each segment (venue, symbol, holding_type) must match /^[A-Za-z0-9_-]+$/
  // — same character set as Phase 08 notes + audit entity_id scope_refs.
  if (!SAFE_PART.test(venue)) return null;
  if (!SAFE_PART.test(symbol)) return null;
  if (!SAFE_PART.test(holding_type)) return null;
  return { venue, symbol, holding_type };
}

export type HoldingCompareAnalytics = {
  cumulative_return: number | null;
  sharpe: number | null;
  max_drawdown: number | null;
  vol: number | null;
  /**
   * Days that carry a valid price (the MIN unit). An item with four null
   * metrics below the minimum still carries it.
   */
  priced_days: number;
};

/**
 * Minimum number of PRICED days a holding needs before any metric is shown.
 * The unit is the one the founder measured on 2026-10-15 ("26 of 36 spot
 * holdings ... have at least 30 priced days"), so it counts days that carry a
 * valid price, not returns. Below it all four metrics are null (never zero).
 * Deliberately not reconciled with the Python warm-up gate, which counts returns.
 */
export const HOLDING_COMPARE_MIN_PRICED_DAYS = 30;

/** Read window: the old snapshots window, and `fetchHoldings`' backfill cap. */
export const HOLDING_COMPARE_WINDOW_DAYS = 730;

/** Rows per page: PostgREST caps a response at `max_rows` (1000) and still answers HTTP 200. */
export const HOLDING_COMPARE_PAGE_SIZE = 1000;

/**
 * Page ceiling: 50000 rows, far above one holding's 730 days times any real
 * key count. Past it the read throws instead of returning a partial series.
 */
export const HOLDING_COMPARE_MAX_PAGES = 50;

/**
 * Why a spot holding that was FOUND (rows exist, the owner is known) carries no
 * metrics. One reason per cause, because each reads differently to the owner:
 * - `fixed_price`: its recorded price is a writer constant (`FIXED_MARK_SET`:
 *   a stablecoin symbol, sFOX).
 * - `account_balance` (M-R2-01): the row is an account balance on a venue that is
 *   not a crypto exchange (MT5 `ACCOUNT-<hex>`), not a traded asset. Its mark can
 *   be the unit's daily close and so varies, which is why it is NOT "fixed".
 * - `no_price` (M-R2-02): a crypto spot holding with rows but NO day carrying a
 *   valid price (the writer's `0.0` failed-ticker sentinel on every day, e.g. an
 *   asset with no `{asset}/USDT` market). Waiting will not fill it, so it is not
 *   the "so far" state.
 */
export type HoldingWithheldReason = "fixed_price" | "account_balance" | "no_price";

export type HoldingCompareItem = {
  kind: "holding";
  holding_ref: string;
  venue: string;
  symbol: string;
  holding_type: string;
} & (
  | { historyState: "ready"; analytics: HoldingCompareAnalytics }
  | { historyState: "rebuilding"; analytics: null }
  | { historyState: "withheld"; analytics: null; withheld_reason: HoldingWithheldReason }
);

/**
 * Holdings whose recorded `mark_price` is a constant the analytics writer
 * stamps, not an observed market price (CR-01, 167.1.1 round 1). A price-based
 * return over a constant 1.0 prints a confident 0.00% return, drawdown and vol,
 * which is an invented number, so these holdings get no metrics.
 *
 * - `stablecoinSymbols` MIRRORS `STABLECOINS` in
 *   analytics-service/services/closed_sets.py (`_fetch_spot_rows` sets
 *   `mark_price = 1.0` for any asset in it, without a ticker call). A parity
 *   test reads that Python literal and fails when the two drift.
 * - `venues`: sFOX's balance builder (`_fetch_sfox_balance_rows`) writes
 *   `"mark_price": 1.0` for every row it keeps. The same parity test pins that
 *   premise in the Python source.
 * - A venue `isCryptoExchange` rejects (MT5 `ACCOUNT-<hex>` rows: a mark of 1.0
 *   or a native close) is not a fixed price but an account balance; see
 *   `holdingWithheldReason`.
 */
export const FIXED_MARK_SET = {
  stablecoinSymbols: new Set(["USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"]),
  venues: new Set(["sfox"]),
} as const;

/**
 * Why a holding's recorded price cannot be read as a market price, or null when
 * it can. Venue and symbol are matched case-insensitively (the writer
 * upper-cases the asset before its set test). A venue `isCryptoExchange`
 * rejects is tested FIRST: such a row is an account balance whatever its
 * symbol (M-R2-01), so it never reads as "fixed price".
 */
export function holdingWithheldReason(
  venue: string,
  symbol: string,
): Extract<HoldingWithheldReason, "fixed_price" | "account_balance"> | null {
  if (!isCryptoExchange(venue)) return "account_balance";
  if (
    FIXED_MARK_SET.venues.has(venue.toLowerCase()) ||
    FIXED_MARK_SET.stablecoinSymbols.has(symbol.toUpperCase())
  ) {
    return "fixed_price";
  }
  return null;
}

/** True when a holding's recorded price is not a market price (any reason above). */
export function holdingMarkIsFixed(venue: string, symbol: string): boolean {
  return holdingWithheldReason(venue, symbol) !== null;
}

/**
 * The holding read failed (Phase 167.1.2 review round 2, SFH-R2-02). The
 * message is deliberately generic: the database's own message is logged
 * server-side and never rides the thrown error.
 */
export class HoldingCompareLoadError extends Error {
  constructor() {
    super("holding compare load failed");
    this.name = "HoldingCompareLoadError";
  }
}

/**
 * Phase 167.1.1 / D-03: whether a holding type's metrics are shown ("ready")
 * or withheld ("rebuilding"). A pure function of the type; there is no global
 * switch and no test seam any more.
 *
 * - "spot" is "ready": its price is `allocator_holdings.mark_price`, one price
 *   per `asof` day (one key per day, see `dailyMarkPrices`), so purchases and
 *   sales do not move it. A mark that is not a finite number above 0 (the
 *   writer's `0.0` failed-ticker sentinel) is a gap, never a price; there is
 *   no zero-fill and no forward-fill. A daily return exists only between two
 *   ADJACENT calendar days that both carry a price, so no return spans a gap.
 *   Fewer than `HOLDING_COMPARE_MIN_PRICED_DAYS` priced days gives null metrics.
 *   A mark is a ticker `last` read at poll time, so the copy says "daily
 *   price", never close-to-close.
 * - Anything else (a derivative) stays "rebuilding" until a signed basis is
 *   defined (deferred, not booked as a phase).
 *
 * Orchestrator reading, flagged for the founder (NOT a founder decision): a
 * spot holding whose recorded price is not a market price
 * (`holdingMarkIsFixed`: MT5 `ACCOUNT-<hex>` rows, stablecoin symbols, sFOX)
 * gets no metrics, never a confident 0%. `fetchHoldingCompareItem` returns it as
 * a "withheld" item, not null, so the page keeps the card and names the cause.
 *
 * Deferred and not touched (SC 4): `reconstruct_symbol_returns` in
 * analytics-service/routers/match.py is the Python twin of the retired
 * dollar-ratio read, and the Bridge matcher still uses it.
 */
export function holdingCompareHistoryState(
  holding_type: string,
): "ready" | "rebuilding" {
  return holding_type === "spot" ? "ready" : "rebuilding";
}

type PriceRow = {
  asof: string;
  mark_price: unknown;
  updated_at: string;
  api_key_id: string;
};

export type DailyPrice = { asof: string; price: number };

/**
 * A stored row broke the read contract (SFH-03, 167.1.1 round 1): `mark_price`
 * is `numeric NOT NULL`, so a value that is not a finite number is a driver or
 * schema change, and `asof` is a `date`, so anything but a `YYYY-MM-DD` string
 * is the same. Carries counts only, never a row value.
 */
export class HoldingMarkContractError extends Error {
  readonly badMarks: number;
  readonly badDays: number;
  constructor(badMarks: number, badDays: number) {
    super(`holding rows broke the read contract (marks: ${badMarks}, days: ${badDays})`);
    this.name = "HoldingMarkContractError";
    this.badMarks = badMarks;
    this.badDays = badDays;
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/**
 * One price per calendar day, ascending by `asof`.
 *
 * Two classes of unusable row, kept apart (SFH-03):
 * - A FINITE number at or below 0 is a gap. It is the writer's documented `0.0`
 *   failed-ticker sentinel (or a nonsense negative); it is skipped BEFORE the
 *   per-day pick, so a later failed poll never eclipses a valid mark.
 * - A mark that is not a finite number, or an `asof` that is not a `YYYY-MM-DD`
 *   string, is a CONTRACT violation (`numeric NOT NULL`, `date`): every row is
 *   checked first, and one offender throws `HoldingMarkContractError` with the
 *   counts. It is never a gap, or a type change would read as "not enough days".
 *
 * Per `asof` the row with the greatest `writtenAtMicros(updated_at)` wins, ties
 * to the smallest lowercase `api_key_id` (the `oneKeyPerAccountDay` tie-break),
 * so two keys holding the asset on one venue never merge or double a day.
 * Throws `HoldingsUpdatedAtError` on a bad `updated_at` of a row that reaches
 * the pick.
 */
export function dailyMarkPrices(rows: readonly PriceRow[]): DailyPrice[] {
  let badMarks = 0;
  let badDays = 0;
  for (const r of rows) {
    if (typeof r.mark_price !== "number" || !Number.isFinite(r.mark_price)) badMarks += 1;
    if (typeof r.asof !== "string" || !ISO_DAY.test(r.asof)) badDays += 1;
  }
  if (badMarks > 0 || badDays > 0) throw new HoldingMarkContractError(badMarks, badDays);

  const best = new Map<string, { price: number; at: number; keyId: string }>();
  for (const r of rows) {
    const m = r.mark_price as number;
    if (!(m > 0)) continue;
    const at = writtenAtMicros(r.updated_at);
    const cur = best.get(r.asof);
    if (
      cur === undefined ||
      at > cur.at ||
      (at === cur.at && r.api_key_id.toLowerCase() < cur.keyId.toLowerCase())
    ) {
      best.set(r.asof, { price: m, at, keyId: r.api_key_id });
    }
  }
  return Array.from(best, ([asof, v]) => ({ asof, price: v.price })).sort(
    (a, b) => (a.asof < b.asof ? -1 : a.asof > b.asof ? 1 : 0),
  );
}

/** True when `b` is exactly the UTC calendar day after `a` (both `YYYY-MM-DD`). */
function isNextDay(a: string, b: string): boolean {
  return Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`) === MS_PER_DAY;
}

type PriceMetrics = Omit<HoldingCompareAnalytics, "priced_days">;

const NULL_METRICS: PriceMetrics = {
  cumulative_return: null,
  sharpe: null,
  max_drawdown: null,
  vol: null,
};

/**
 * The four metrics over a daily PRICE series (ascending by `asof`).
 *
 * - Cumulative return = last price / first price - 1, and max drawdown = the
 *   most negative `(p - peak) / peak` over the running peak. Both read the
 *   price LEVEL series over the priced days, which is not a return series and
 *   needs no adjacency.
 * - A daily return `p[i] / p[i-1] - 1` is taken ONLY when `asof[i]` is exactly
 *   the calendar day after `asof[i-1]`. A missing day breaks the chain, so no
 *   return spans a gap. Vol (`dispersion(returns, 0).sd * sqrt(periodsPerYear)`)
 *   and Sharpe (the return-stats `sharpe`, population sd) are over those
 *   one-day returns only, and are null with fewer than 2 of them.
 * - Fewer than 2 points gives four nulls: uncomputable is null, never zero.
 */
export function analyzePriceSeries(
  points: readonly DailyPrice[],
  periodsPerYear: number,
): PriceMetrics {
  if (points.length < 2) return { ...NULL_METRICS };

  const cumulative_return = points[points.length - 1].price / points[0].price - 1;

  let peak = points[0].price;
  let maxDD = 0;
  for (const { price } of points) {
    if (price > peak) peak = price;
    const dd = (price - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }

  const returns: number[] = [];
  for (let i = 1; i < points.length; i++) {
    if (!isNextDay(points[i - 1].asof, points[i].asof)) continue;
    returns.push(points[i].price / points[i - 1].price - 1);
  }
  const vol =
    returns.length >= 2
      ? dispersion(returns, 0).sd * Math.sqrt(periodsPerYear)
      : null;
  const sharpe = returnStatsSharpe(returns, { periodsPerYear, ddof: 0 });

  return {
    cumulative_return: Number.isFinite(cumulative_return) ? cumulative_return : null,
    sharpe: sharpe != null && Number.isFinite(sharpe) ? sharpe : null,
    max_drawdown: Number.isFinite(maxDD) ? maxDD : null,
    vol: vol != null && Number.isFinite(vol) ? vol : null,
  };
}

/**
 * Fetch a holding's comparison item via user-scoped supabase client.
 *
 * Returns null when:
 * - parse fails (incl. charset rejection per finding f6)
 * - zero `allocator_holdings` rows (RLS-blocked or no data, D-15 no existence leak)
 * - the holding type is neither "spot" nor "derivative"
 *
 * Per D-15: caller cannot distinguish "unowned holding" from "nonexistent
 * holding" — both return null with no additional error information. Null means
 * ONLY that: a holding that exists and is owned is never null (SFH-01).
 *
 * Per type: a derivative with rows is "rebuilding" with no analytics; a spot
 * holding whose recorded price is not a market price (`holdingMarkIsFixed`) is
 * "withheld" with reason "fixed_price" or "account_balance" (rows were found, so the owner is known
 * and no existence leaks); a crypto spot holding with rows but no priced day at all is "withheld"
 * with reason "no_price" and logged (M-R2-02); any other spot holding with rows is "ready" (four
 * null metrics below the minimum priced days, and
 * `annualizationPeriods("crypto")` annualization).
 *
 * Throws `HoldingCompareLoadError` when the query itself fails or the read
 * exceeds the page ceiling (never a silent partial series), and when a stored
 * `updated_at` is unusable or a row breaks the read contract (a non-numeric
 * mark, a non-ISO `asof`: SFH-03). A failed read is not "not available": RLS hides an
 * unowned holding as ZERO rows, never as an error, so surfacing the failure
 * leaks nothing about ownership (D-15 unchanged) and gives the allocator a
 * retry instead of a false "this comparison isn't available".
 */
export async function fetchHoldingCompareItem(params: {
  allocator_id: string;
  holding_ref: string;
  supabase: SupabaseClient;
}): Promise<HoldingCompareItem | null> {
  const parsed = parseHoldingCompareId(params.holding_ref);
  if (!parsed) return null;

  const windowStart = new Date(Date.now() - HOLDING_COMPARE_WINDOW_DAYS * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);

  // Total order (asof, then the id PK) so `.range()` pages never skip or
  // duplicate rows across a page boundary; rows are grouped only after every
  // page is collected (a day can span two pages).
  const rows: PriceRow[] = [];
  for (let page = 0; ; page += 1) {
    const from = page * HOLDING_COMPARE_PAGE_SIZE;
    const { data, error } = await params.supabase
      .from("allocator_holdings")
      .select("asof, mark_price, updated_at, api_key_id")
      .eq("allocator_id", params.allocator_id)
      .eq("venue", parsed.venue)
      .eq("symbol", parsed.symbol)
      .eq("holding_type", parsed.holding_type)
      .gte("asof", windowStart)
      .order("asof", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + HOLDING_COMPARE_PAGE_SIZE - 1);

    if (error) {
      // Log the message only (never the row payload), then throw so the page
      // surfaces a failed load (SFH-R2-02).
      console.error(
        "[holding-compare-adapter.fetchHoldingCompareItem] supabase error:",
        error.message,
      );
      throw new HoldingCompareLoadError();
    }
    const batch = (data ?? []) as PriceRow[];
    rows.push(...batch);
    if (batch.length < HOLDING_COMPARE_PAGE_SIZE) break;
    if (page + 1 >= HOLDING_COMPARE_MAX_PAGES) {
      console.error(
        `[holding-compare-adapter.fetchHoldingCompareItem] read exceeded ${HOLDING_COMPARE_MAX_PAGES} pages of ${HOLDING_COMPARE_PAGE_SIZE} rows`,
      );
      throw new HoldingCompareLoadError();
    }
  }
  if (rows.length === 0) return null;

  const base = {
    kind: "holding" as const,
    holding_ref: params.holding_ref,
    venue: parsed.venue,
    symbol: parsed.symbol,
    holding_type: parsed.holding_type,
  };

  if (parsed.holding_type !== "spot" && parsed.holding_type !== "derivative") {
    return null;
  }
  if (holdingCompareHistoryState(parsed.holding_type) === "rebuilding") {
    return { ...base, historyState: "rebuilding", analytics: null };
  }
  // Orchestrator reading, flagged for the founder (NOT a founder decision): a
  // price-based return over a writer constant would print a confident 0%
  // (CR-01). Rows were found above, so this is an owned holding: say why it has
  // no metrics instead of collapsing it into the D-15 null (SFH-01). The marks
  // are deliberately not read, so a malformed one here is not a contract error.
  const fixedReason = holdingWithheldReason(parsed.venue, parsed.symbol);
  if (fixedReason !== null) {
    return { ...base, historyState: "withheld", analytics: null, withheld_reason: fixedReason };
  }

  let points: DailyPrice[];
  try {
    points = dailyMarkPrices(rows);
  } catch (e) {
    if (e instanceof HoldingMarkContractError) {
      // Counts and the holding ref only; never a row value (SFH-03).
      console.error(
        `[holding-compare-adapter.fetchHoldingCompareItem] read contract violated for ${params.holding_ref}: ${e.badMarks} row(s) with a non-numeric mark_price, ${e.badDays} row(s) with an asof that is not YYYY-MM-DD`,
      );
      throw new HoldingCompareLoadError();
    }
    if (e instanceof HoldingsUpdatedAtError) {
      console.error(
        "[holding-compare-adapter.fetchHoldingCompareItem] unusable updated_at:",
        e.message,
      );
      throw new HoldingCompareLoadError();
    }
    throw e;
  }

  // M-R2-02: rows exist (the owner is known) but not one day carries a valid
  // price. The writer marks an asset with no `{asset}/USDT` market at 0.0 on every
  // day, so "Only 0 priced days so far" would promise a history that never comes,
  // and silence would make it look like a newly connected holding. Withhold with a
  // named reason and log the ref and the row count (no ids, no values). One or more
  // priced days stays "ready": there the history IS filling.
  if (points.length === 0) {
    console.warn(
      `[holding-compare-adapter.fetchHoldingCompareItem] no priced day for ${params.holding_ref}: ${rows.length} row(s), none with a valid mark_price`,
    );
    return { ...base, historyState: "withheld", analytics: null, withheld_reason: "no_price" };
  }

  const metrics =
    points.length >= HOLDING_COMPARE_MIN_PRICED_DAYS
      ? analyzePriceSeries(points, annualizationPeriods("crypto"))
      : NULL_METRICS;
  return {
    ...base,
    historyState: "ready",
    analytics: { ...metrics, priced_days: points.length },
  };
}
