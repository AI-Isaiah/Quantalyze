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
 * of an asset is not read as a gain or loss.
 *
 * Phase 167.1.1.1 / D-02: a derivative reads the same daily mark price, signed by
 * each day's long or short direction (`allocator_holdings.side`), so a price fall
 * is a gain while the position was short; an option is withheld (its mark is a
 * premium). Both holding types now reach the price rule, so no holding type is
 * left waiting. The Bridge matcher reads the same marks through the Python twin
 * in analytics-service/services/holding_marks.py, and one shared fixture pins the
 * two runtimes, so a holding cannot read differently on /compare and in the
 * matcher.
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
 * Why a holding that was FOUND (rows exist, the owner is known) carries no
 * metrics. One reason per cause, because each reads differently to the owner:
 * - `fixed_price`: its recorded price is a writer constant (`FIXED_MARK_SET`:
 *   a stable-value symbol, sFOX).
 * - `account_balance` (M-R2-01): the row is an account balance on a venue that is
 *   not a crypto exchange (MT5 `ACCOUNT-<hex>`), not a traded asset. Its mark can
 *   be the unit's daily close and so varies, which is why it is NOT "fixed".
 * - `no_price` (M-R2-02): a crypto spot holding with rows but NO day carrying a
 *   valid price (the writer's `0.0` failed-ticker sentinel on every day, e.g. an
 *   asset with no `{asset}/USDT` market). Waiting will not fill it, so it is not
 *   the "so far" state. For a derivative the same cause is every mark `<= 0`.
 * - `no_direction` (167.1.1.1 D-02): a derivative with positive marks but no day on
 *   which its long or short direction is established (every row `flat`, or the
 *   rows of each day disagree). A sign is never guessed.
 * - `option_premium` (167.1.1.1 D-10): an option; its mark is a premium, not a
 *   price, so no return is computed from it.
 */
export type HoldingWithheldReason =
  | "fixed_price"
  | "account_balance"
  | "no_price"
  | "no_direction"
  | "option_premium";

/**
 * Phase 167.1.1.1 / D-03, D-10, D-12: every reason the price rule can withhold a
 * holding by, the five above plus `too_few_priced_days` (priced, but fewer than
 * `HOLDING_COMPARE_MIN_PRICED_DAYS` days; /compare renders it as a ready item with
 * null metrics and the threshold sentence, never as a withheld note). The
 * Python twin is `PRICE_RULE_WITHHELD_REASONS` in
 * analytics-service/services/holding_marks.py; the shared fixture
 * holding_mark_returns_cases.json pins both lists.
 */
export type HoldingMarkWithheldReason =
  | HoldingWithheldReason
  | "too_few_priced_days"
  | "no_direction"
  | "option_premium";

export const HOLDING_MARK_WITHHELD_REASONS: readonly HoldingMarkWithheldReason[] = [
  "account_balance",
  "fixed_price",
  "no_direction",
  "no_price",
  "option_premium",
  "too_few_priced_days",
];

export type HoldingCompareItem = {
  kind: "holding";
  holding_ref: string;
  venue: string;
  symbol: string;
  holding_type: string;
} & (
  | { historyState: "ready"; analytics: HoldingCompareAnalytics }
  | { historyState: "withheld"; analytics: null; withheld_reason: HoldingWithheldReason }
);

/**
 * Holdings whose recorded `mark_price` is a constant the analytics writer
 * stamps, not an observed market price (CR-01, 167.1.1 round 1). A price-based
 * return over a constant 1.0 prints a confident 0.00% return, drawdown and vol,
 * which is an invented number, so these holdings get no metrics.
 *
 * - `stablecoinSymbols` MIRRORS the set `price_rule.is_stable_value` tests:
 *   `STABLECOINS | STABLECOIN_SPLIT_SUFFIXES` in
 *   analytics-service/services/closed_sets.py (the holdings poll sets
 *   `mark_price = 1.0` for any asset in it, without a ticker call). A parity
 *   test reads both Python literals and fails when either drifts.
 * - `venues`: sFOX's balance builder (`_fetch_sfox_balance_rows`) writes
 *   `"mark_price": 1.0` for every row it keeps. The same parity test pins that
 *   premise in the Python source.
 * - A venue `isCryptoExchange` rejects (MT5 `ACCOUNT-<hex>` rows: a mark of 1.0
 *   or a native close) is not a fixed price but an account balance; see
 *   `holdingWithheldReason`.
 */
export const FIXED_MARK_SET = {
  stablecoinSymbols: new Set([
    "USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD",
    "USDE", "PYUSD", "USDB",
  ]),
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

type PriceRow = {
  asof: string;
  mark_price: unknown;
  updated_at: string;
  api_key_id: string;
  /** Read by the derivative rule only (long, short, flat); the spot rule ignores it. */
  side?: unknown;
};

export type DailyPrice = { asof: string; price: number };

/** One priced derivative day; `direction` is null when the day has no established one. */
export type DirectedPrice = {
  asof: string;
  price: number;
  direction: "long" | "short" | null;
};

/**
 * D-12: a signed one-day return is floored at -100%. A short whose mark more than doubles
 * loses more than the position, which a holder cannot, and an unfloored value would drive
 * NAV below zero. Twin of `SIGNED_RETURN_FLOOR` in holding_marks.py.
 */
export const SIGNED_RETURN_FLOOR = -1;

const DERIVATIVE_SIDES: ReadonlySet<unknown> = new Set(["long", "short", "flat"]);

/**
 * A stored row broke the read contract (SFH-03, 167.1.1 round 1): `mark_price`
 * is `numeric NOT NULL`, so a value that is not a finite number is a driver or
 * schema change, and `asof` is a `date`, so anything but a `YYYY-MM-DD` string
 * is the same. A derivative's `side` must be long, short or flat (`badSides`, 167.1.1.1
 * D-02). Carries counts only, never a row value.
 */
export class HoldingMarkContractError extends Error {
  readonly badMarks: number;
  readonly badDays: number;
  readonly badSides: number;
  constructor(badMarks: number, badDays: number, badSides = 0) {
    const detail = `marks: ${badMarks}, days: ${badDays}${badSides > 0 ? `, sides: ${badSides}` : ""}`;
    super(`holding rows broke the read contract (${detail})`);
    this.name = "HoldingMarkContractError";
    this.badMarks = badMarks;
    this.badDays = badDays;
    this.badSides = badSides;
  }
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/**
 * True for a `YYYY-MM-DD` string that is a REAL calendar date. The shape alone let
 * 2026-02-30 through, and Python's `date.fromisoformat` rejects it, so the two
 * runtimes would disagree (167.1.1.1 D-03). The round trip rejects what `Date`
 * would roll over; an unparseable input gives NaN before `toISOString` can throw.
 */
function isRealIsoDay(asof: unknown): boolean {
  if (typeof asof !== "string" || !ISO_DAY.test(asof)) return false;
  const t = Date.parse(`${asof}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === asof;
}

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
    if (!isRealIsoDay(r.asof)) badDays += 1;
  }
  if (badMarks > 0 || badDays > 0) throw new HoldingMarkContractError(badMarks, badDays);
  return pickDailyMarks(rows);
}

/**
 * The per-day pick shared by the spot and derivative rules. Rows must already have passed
 * the read contract. Marks at or below 0 are skipped first; per `asof` the greatest
 * `writtenAtMicros(updated_at)` wins, ties to the smallest lowercase `api_key_id`.
 */
function pickDailyMarks(rows: readonly PriceRow[]): DailyPrice[] {
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

/**
 * The derivative twin of `dailyMarkPrices` (167.1.1.1 D-02): one mark per day picked
 * exactly as the spot rule picks it, plus the day's direction.
 *
 * The read contract adds `side` in {long, short, flat}: anything else (null and a missing
 * value included) throws `HoldingMarkContractError` with a `badSides` count, never a gap.
 * The direction comes from ALL rows of the day, every key and every row whose mark is a
 * gap included: unanimous long or unanimous short gives that direction, anything else (a
 * `flat` row, or both sides) gives null. A day with no positive mark is absent. Direction
 * is read from `side` only, never from quantity or value. Twin of `daily_directed_marks`.
 */
export function dailyDirectedMarks(rows: readonly PriceRow[]): DirectedPrice[] {
  let badMarks = 0;
  let badDays = 0;
  let badSides = 0;
  for (const r of rows) {
    if (typeof r.mark_price !== "number" || !Number.isFinite(r.mark_price)) badMarks += 1;
    if (!isRealIsoDay(r.asof)) badDays += 1;
    if (!DERIVATIVE_SIDES.has(r.side)) badSides += 1;
  }
  if (badMarks > 0 || badDays > 0 || badSides > 0) {
    throw new HoldingMarkContractError(badMarks, badDays, badSides);
  }
  const sidesByDay = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = sidesByDay.get(r.asof) ?? new Set<string>();
    set.add(r.side as string);
    sidesByDay.set(r.asof, set);
  }
  return pickDailyMarks(rows).map(({ asof, price }) => {
    const sides = sidesByDay.get(asof)!;
    const only = sides.size === 1 ? [...sides][0] : null;
    return { asof, price, direction: only === "long" || only === "short" ? only : null };
  });
}

/** True when `b` is exactly the UTC calendar day after `a` (both `YYYY-MM-DD`). */
function isNextDay(a: string, b: string): boolean {
  return Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`) === MS_PER_DAY;
}

/**
 * The one-day returns of a daily PRICE series (ascending by `asof`): `[later_asof,
 * p[i] / p[i-1] - 1]` for each pair of consecutive points exactly one UTC calendar
 * day apart. A missing day breaks the chain, so no return spans a gap. Twin of
 * `adjacent_daily_returns` in analytics-service/services/holding_marks.py.
 */
export function adjacentDailyReturns(points: readonly DailyPrice[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (let i = 1; i < points.length; i++) {
    if (!isNextDay(points[i - 1].asof, points[i].asof)) continue;
    out.push([points[i].asof, points[i].price / points[i - 1].price - 1]);
  }
  return out;
}

/**
 * The signed one-day returns of a derivative's directed days (ascending by `asof`):
 * `[later_asof, r]` for each pair of consecutive days exactly one UTC calendar day apart
 * where BOTH days carry a direction. `r = s(i-1) * (p[i] / p[i-1] - 1)`: the interval
 * carries the direction of the EARLIER day (the position held over it), `s` is +1 long and
 * -1 short, and `r` is floored at `SIGNED_RETURN_FLOOR` (D-12). Twin of
 * `signed_adjacent_returns`.
 */
export function signedAdjacentReturns(days: readonly DirectedPrice[]): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (let i = 1; i < days.length; i++) {
    const earlier = days[i - 1];
    const later = days[i];
    if (earlier.direction === null || later.direction === null) continue;
    if (!isNextDay(earlier.asof, later.asof)) continue;
    const sign = earlier.direction === "long" ? 1 : -1;
    out.push([later.asof, Math.max(sign * (later.price / earlier.price - 1), SIGNED_RETURN_FLOOR)]);
  }
  return out;
}

/**
 * True for an option instrument (D-10): the upper-cased name ends `-C` or `-P`, which is
 * what `classify_instrument` in analytics-service/services/deribit_txn.py tests first. A
 * lowercase name and a linear-margin name (`ETH_USDC-27MAR26-50000-C`) are options; a
 * perpetual or a dated future is not. The shared fixture pins both runtimes.
 */
export function isOptionSymbol(symbol: string): boolean {
  if (typeof symbol !== "string") return false;
  const name = symbol.toUpperCase();
  return name.endsWith("-C") || name.endsWith("-P");
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

  const returns = adjacentDailyReturns(points).map(([, r]) => r);
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
 * The four metrics over a derivative's SIGNED one-day returns (167.1.1.1 D-12).
 *
 * NAV starts at 1 and compounds, `NAV_k = product of (1 + r_i)`. Cumulative return is
 * `NAV_last - 1` and max drawdown the most negative `(NAV - peak) / peak`, the peak
 * starting at NAV 1. Vol and Sharpe are over the same return list, exactly as
 * `analyzePriceSeries` computes them (population sd). An EMPTY list gives null cumulative
 * return and null drawdown: uncomputable is null, never a confident 0%. A long-only,
 * gap-free derivative gives the same cumulative return and drawdown as the spot level form.
 */
export function analyzeSignedReturns(
  returns: number[],
  periodsPerYear: number,
): PriceMetrics {
  if (returns.length === 0) return { ...NULL_METRICS };

  let nav = 1;
  let peak = 1;
  let maxDD = 0;
  for (const r of returns) {
    nav *= 1 + r;
    if (nav > peak) peak = nav;
    const dd = (nav - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  const cumulative_return = nav - 1;

  const vol =
    returns.length >= 2 ? dispersion(returns, 0).sd * Math.sqrt(periodsPerYear) : null;
  const sharpe = returnStatsSharpe(returns, { periodsPerYear, ddof: 0 });

  return {
    cumulative_return: Number.isFinite(cumulative_return) ? cumulative_return : null,
    sharpe: sharpe != null && Number.isFinite(sharpe) ? sharpe : null,
    max_drawdown: Number.isFinite(maxDD) ? maxDD : null,
    vol: vol != null && Number.isFinite(vol) ? vol : null,
  };
}

/**
 * What the price rule says about one holding (167.1.1.1 D-03). `withheld_reason`
 * is null when the holding is priced well enough to use. `priced_days`, `returns` and
 * `points` are filled whenever marks were read (the `too_few_priced_days` case
 * included) and are 0 / empty when a venue or symbol gate withheld it first.
 */
export type HoldingMarks = {
  withheld_reason: HoldingMarkWithheldReason | null;
  priced_days: number;
  returns: Array<[string, number]>;
  points: DailyPrice[];
};

/**
 * The spot withheld ladder, in this order (twin of `classify_spot_marks`):
 * 1. `account_balance`, then `fixed_price` from `holdingWithheldReason`: venue and
 *    symbol only, the marks are NOT read, so a malformed mark there is not a contract
 *    error;
 * 2. the read contract (`dailyMarkPrices` throws `HoldingMarkContractError`, or
 *    `HoldingsUpdatedAtError` on an unusable `updated_at`);
 * 3. `no_price`: no day carries a valid mark;
 * 4. `too_few_priced_days`: fewer than `HOLDING_COMPARE_MIN_PRICED_DAYS` priced days;
 * 5. otherwise null.
 */
export function classifySpotMarks(
  rows: readonly PriceRow[],
  venue: string,
  symbol: string,
): HoldingMarks {
  const fixed = holdingWithheldReason(venue, symbol);
  if (fixed !== null) return { withheld_reason: fixed, priced_days: 0, returns: [], points: [] };
  const points = dailyMarkPrices(rows);
  if (points.length === 0) {
    return { withheld_reason: "no_price", priced_days: 0, returns: [], points };
  }
  return {
    withheld_reason: points.length < HOLDING_COMPARE_MIN_PRICED_DAYS ? "too_few_priced_days" : null,
    priced_days: points.length,
    returns: adjacentDailyReturns(points),
    points,
  };
}

/**
 * The derivative withheld ladder, in this order (twin of `classify_derivative_marks`):
 * 1. `option_premium`: decided from the symbol alone, the marks are NOT read;
 * 2. the read contract (`dailyDirectedMarks` throws, `side` included);
 * 3. `no_price`: no day carries a positive mark;
 * 4. `no_direction`: positive marks exist but no day is usable;
 * 5. `too_few_priced_days`: fewer than `HOLDING_COMPARE_MIN_PRICED_DAYS` USABLE days (a
 *    positive mark AND an established direction), with `priced_days` and `returns` filled;
 * 6. otherwise null.
 * `points` carries the usable days' prices.
 */
export function classifyDerivativeMarks(rows: readonly PriceRow[], symbol: string): HoldingMarks {
  if (isOptionSymbol(symbol)) {
    return { withheld_reason: "option_premium", priced_days: 0, returns: [], points: [] };
  }
  const days = dailyDirectedMarks(rows);
  if (days.length === 0) {
    return { withheld_reason: "no_price", priced_days: 0, returns: [], points: [] };
  }
  const usable = days.filter((d) => d.direction !== null);
  if (usable.length === 0) {
    return { withheld_reason: "no_direction", priced_days: 0, returns: [], points: [] };
  }
  return {
    withheld_reason: usable.length < HOLDING_COMPARE_MIN_PRICED_DAYS ? "too_few_priced_days" : null,
    priced_days: usable.length,
    returns: signedAdjacentReturns(days),
    points: usable.map(({ asof, price }) => ({ asof, price })),
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
 * Both types reach the price rule. A daily return exists only between two ADJACENT
 * calendar days, so no return spans a gap (no zero-fill, no forward-fill). A mark is a
 * ticker `last` read at poll time, so the copy says "daily price", never close-to-close.
 *
 * - Spot: a holding whose recorded price is not a market price (`holdingMarkIsFixed`) is
 *   "withheld" with reason "fixed_price" or "account_balance" (rows were found, so the
 *   owner is known and no existence leaks); a crypto holding with rows but no priced day
 *   is "withheld" with "no_price" and logged (M-R2-02); any other is "ready", with four
 *   null metrics below the minimum priced days and `annualizationPeriods("crypto")`
 *   annualization.
 * - Derivative (167.1.1.1 D-02): the read also takes `side`, and the marks go through
 *   `classifyDerivativeMarks`. An option is "withheld" `option_premium`; no positive mark
 *   is `no_price`; positive marks with no established direction is `no_direction`
 *   (logged, counts only). Otherwise "ready", with the signed-return metrics at or above
 *   the minimum usable days and null metrics below it.
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
      .select("asof, mark_price, updated_at, api_key_id, side")
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
  const isDerivative = parsed.holding_type === "derivative";
  // Orchestrator reading, flagged for the founder (NOT a founder decision): a
  // price-based return over a writer constant would print a confident 0%
  // (CR-01). Rows were found above, so this is an owned holding: say why it has
  // no metrics instead of collapsing it into the D-15 null (SFH-01). A spot
  // holding's marks are deliberately not read on that path, so a malformed one
  // there is not a contract error (`classifySpotMarks` decides from venue and
  // symbol first); an option's are not read either (`classifyDerivativeMarks`
  // decides from the symbol first).
  let marks: HoldingMarks;
  try {
    marks = isDerivative
      ? classifyDerivativeMarks(rows, parsed.symbol)
      : classifySpotMarks(rows, parsed.venue, parsed.symbol);
  } catch (e) {
    if (e instanceof HoldingMarkContractError) {
      // Counts and the holding ref only; never a row value (SFH-03).
      console.error(
        `[holding-compare-adapter.fetchHoldingCompareItem] read contract violated for ${params.holding_ref}: ${e.badMarks} row(s) with a non-numeric mark_price, ${e.badDays} row(s) with an asof that is not a real YYYY-MM-DD date, ${e.badSides} row(s) with a side outside long, short or flat`,
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
  // priced days stays "ready": there the history IS filling. `no_direction` is the
  // derivative twin: marks exist but no day has a long or short direction.
  const reason = marks.withheld_reason;
  if (reason !== null && reason !== "too_few_priced_days") {
    if (reason === "no_price") {
      console.warn(
        `[holding-compare-adapter.fetchHoldingCompareItem] no priced day for ${params.holding_ref}: ${rows.length} row(s), none with a valid mark_price`,
      );
    } else if (reason === "no_direction") {
      console.warn(
        `[holding-compare-adapter.fetchHoldingCompareItem] no established direction for ${params.holding_ref}: ${rows.length} row(s), none on a day with a single long or short side`,
      );
    }
    return { ...base, historyState: "withheld", analytics: null, withheld_reason: reason };
  }

  let metrics: PriceMetrics = NULL_METRICS;
  if (reason === null) {
    metrics = isDerivative
      ? analyzeSignedReturns(
          marks.returns.map(([, r]) => r),
          annualizationPeriods("crypto"),
        )
      : analyzePriceSeries(marks.points, annualizationPeriods("crypto"));
  }
  return {
    ...base,
    historyState: "ready",
    analytics: { ...metrics, priced_days: marks.priced_days },
  };
}
