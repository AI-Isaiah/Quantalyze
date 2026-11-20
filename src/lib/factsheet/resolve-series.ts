import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { normalizeDailyReturns } from "@/lib/portfolio-math-utils";
import type { DailyReturn } from "./types";

/**
 * How a stored cumulative curve was built (`data_quality_flags.cumulative_method`,
 * the raw worker strings). `geometric` is `(1 + r).cumprod()`; `simple` is
 * `1 + r.cumsum()`.
 */
export type CurveMethod = "geometric" | "simple";

/**
 * Read the curve method off a row's `data_quality_flags` (Phase 164.6.6.2.2
 * D-05). Strict literals: `geometric` and `simple` are the only values read.
 * An absent flags blob, absent key or null key reads geometric silently (the
 * platform default); any other PRESENT value logs one warning, without echoing
 * the value, and reads geometric. Twin of `curve_method_from_flags` in
 * `analytics-service/services/wealth_returns.py`.
 */
export function curveMethodFromFlags(dqf: unknown): CurveMethod {
  if (dqf === null || typeof dqf !== "object" || Array.isArray(dqf)) return "geometric";
  const raw = (dqf as { cumulative_method?: unknown }).cumulative_method;
  if (raw === undefined || raw === null) return "geometric";
  if (raw === "geometric" || raw === "simple") return raw;
  console.warn(
    "[factsheet] curveMethodFromFlags: unrecognised cumulative_method; reading geometric",
  );
  return "geometric";
}

/**
 * Read a stored CURVE into `{ date, value }` points WITHOUT dropping a bad
 * level. For an array input every element that is an object with a string
 * `date` is kept; a non-number or non-finite `value` becomes `NaN` in place, so
 * the days that depend on it stay absent instead of being bridged. Any other
 * input shape (the flat and nested dict forms) goes through
 * `normalizeDailyReturns`, unchanged.
 */
function normalizeCurve(raw: unknown): DailyPoint[] {
  if (!Array.isArray(raw)) return normalizeDailyReturns(raw);
  const points: DailyPoint[] = [];
  for (const p of raw) {
    if (p === null || typeof p !== "object") continue;
    const { date, value } = p as { date?: unknown; value?: unknown };
    if (typeof date !== "string") continue;
    points.push({
      date,
      value: typeof value === "number" && Number.isFinite(value) ? value : Number.NaN,
    });
  }
  return points;
}

/**
 * The writer's cap on a stored curve: `cap_data_points(returns_series)` in
 * `analytics-service/services/transforms.py` keeps the MOST RECENT 5000 points
 * (`max_points=5000`). A curve at or above this length may have lost its head, so
 * its first level is not anchored at 1.0 and {@link equityCurveToDailyReturns}
 * never reads day 0 from it (`fromBase`). Pinned to the writer's default and to the
 * Python twin through `stored_curve_max_points` in the shared oracle.
 */
export const STORED_CURVE_MAX_POINTS = 5000;

/**
 * Convert a stored cumulative curve into the daily-return series the
 * FactsheetPayload builder expects. The points are sorted by date and then
 * paired by STORED adjacency, without filtering first:
 *
 *   geometric:  r_k = w_k / w_{k-1} - 1   both levels finite and > 0
 *   simple:     r_k = w_k - w_{k-1}       both levels finite
 *
 * Day 0 (`fromBase`, G3-1 (a), Phase 155.2 plan 15). The analytics writer stores a
 * strategy's curve WITHOUT a base point: `services/metrics.py` writes
 * `(1 + r).cumprod()` (geometric) or `1 + r.cumsum()` (simple), so the first stored
 * level is `1 + r0` and the curve is anchored at an implicit 1.0. With `fromBase`
 * true the first sorted point is paired with that implicit 1.0 predecessor and day
 * 0 emits `w0 - 1` at its own date on the same usability rule as every other day
 * (geometric needs w0 finite and > 0, simple needs w0 finite). A stored curve then
 * reads as n daily returns, not n-1, which is the n observations the persisted
 * factsheet metrics run on. A curve of {@link STORED_CURVE_MAX_POINTS} points or
 * more never emits day 0: the writer caps there, so its head may have been cut and
 * `w0` would be a multi-year cumulative return booked as one day.
 *
 * `fromBase` defaults to FALSE here on purpose. This raw function is also called
 * directly on curves that have no 1.0 base: the allocator's blended equity wealth
 * (`buildAllocatorPortfolioFactsheetPayload`) and the two `ReturnHistogram`
 * curves (a scenario blend's series and a benchmark curve). Reading those against
 * 1.0 would fabricate a return. The row-level reader
 * {@link resolveDailyReturnSeries}, which only ever sees a stored strategy curve,
 * turns it on.
 *
 * A day whose pair is unusable is ABSENT: never 0, never carried, and never
 * bridged across the bad level (the day after a bad level pairs with the bad
 * level, so it is absent too). A non-positive level is legal on the simple curve
 * and unusable on the geometric. Duplicate dates are not deduped here (the Python
 * twin dedupes; the shared oracle leaves that rule out).
 *
 * `analytics-service/services/wealth_returns.py` is the Python twin; both are
 * pinned to `analytics-service/tests/fixtures/wealth_to_returns_oracle.json`.
 *
 * Returns an empty array when the input has fewer than two points (fewer than one
 * under `fromBase`). The default method is geometric, which is also what the
 * allocator's own blended equity wealth (a cumulative product of 1 + r) needs.
 *
 * `keepAbsent` (WR-02, 164.6.6.2.2 review): keep every absent day, day 0 included
 * under `fromBase`, in the output as a `NaN` placeholder at its own date instead
 * of deleting it. The one consumer is {@link convertNativeReturnsToUsd}, which
 * prices a day's native return by the BTC move over `[previous series date, this
 * date]`: with the absent day deleted that interval silently grew to span the
 * whole gap, so a one-day native return was multiplied by a multi-day price move.
 * With the placeholder kept, the converter skips the NaN day and prices the next
 * day over its own single interval. A series built this way carries NaN and MUST
 * go through the converter (which drops it), never into a blend or a payload.
 * Twin of `curve_to_daily_returns(keep_absent=True)`.
 */
export function equityCurveToDailyReturns(
  points: DailyPoint[],
  method: CurveMethod = "geometric",
  keepAbsent = false,
  fromBase = false,
): DailyReturn[] {
  if (!Array.isArray(points) || points.length < (fromBase ? 1 : 2)) return [];
  const sorted = points
    .filter((p) => p && typeof p.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));
  const emitDayZero = fromBase && sorted.length < STORED_CURVE_MAX_POINTS;
  const out: DailyReturn[] = [];
  for (let i = emitDayZero ? 0 : 1; i < sorted.length; i++) {
    const prev = i === 0 ? 1 : sorted[i - 1].value;
    const curr = sorted[i].value;
    const usable =
      Number.isFinite(prev) &&
      Number.isFinite(curr) &&
      (method === "simple" || (prev > 0 && curr > 0));
    if (usable) {
      out.push({
        date: sorted[i].date,
        value: method === "simple" ? curr - prev : curr / prev - 1,
      });
    } else if (keepAbsent) {
      out.push({ date: sorted[i].date, value: Number.NaN });
    }
  }
  return keepAbsent && !out.some((p) => Number.isFinite(p.value)) ? [] : out;
}

/**
 * Resolve the analytics-row return series into the daily-return shape the
 * factsheet builder expects, handling the analytics-service column drift.
 *
 * Order (D-02): the `daily_returns` column wins when it holds at least one
 * finite value (null, `[]`, `{}` and a series without a finite value fall
 * through). `daily_returns` is only populated by CSV ingest, so an
 * analytics-only strategy leaves it null and the series is DERIVED from
 * `returns_series`, the cumulative CURVE the analytics worker writes. The
 * curve is read by the row's own `method` (see {@link curveMethodFromFlags}):
 * pass `curveMethodFromFlags(row.data_quality_flags)`. A curve level is never
 * read as a return: a level of 1.30 is not a +130% day.
 *
 * `keepAbsent` is honoured only on the curve-derived path (a winning
 * `daily_returns` column is returned as stored) and is for the native -> USD
 * conversion only: see {@link equityCurveToDailyReturns}. Pass it as
 * `unit != null`, so a USD series can never carry a `NaN` placeholder.
 *
 * `fromBase` (default TRUE, G3-1 (a)): the curve here is always a stored strategy
 * curve, anchored at an implicit 1.0, so day 0 is read as `w0 - 1`. A caller whose
 * curve was cut before it got here passes false. See
 * {@link equityCurveToDailyReturns} for the rule and the cap.
 */
export function resolveDailyReturnSeries(
  dailyReturnsRaw: unknown,
  returnsSeriesRaw: unknown,
  method: CurveMethod = "geometric",
  keepAbsent = false,
  fromBase = true,
): DailyReturn[] {
  const direct = normalizeDailyReturns(dailyReturnsRaw);
  if (direct.length > 0) return direct;
  // WR-01 (155.2 gap review): day 0 reads against the implicit 1.0 only when the curve's first
  // STORED element survived `normalizeCurve`. A dropped head (non-object, non-string date) leaves
  // the second level as the first point; reading that against 1.0 would book two days of
  // compounding as one return, so the n-1 pairing stays. Twin of `daily_returns_from_row`.
  const head: unknown = Array.isArray(returnsSeriesRaw) ? returnsSeriesRaw[0] : undefined;
  const headKept =
    !Array.isArray(returnsSeriesRaw) ||
    (head !== null && typeof head === "object" && typeof (head as { date?: unknown }).date === "string");
  return equityCurveToDailyReturns(
    normalizeCurve(returnsSeriesRaw),
    method,
    keepAbsent,
    fromBase && headKept,
  );
}

/**
 * 194.2 (D-02) - the record's first return date for a CURVE-DERIVED series: the stored
 * `returns_series` curve's FIRST point, verbatim (the first stored element, never an earliest-valid
 * scan, so a malformed one stays malformed and reads `unreadable`). Since G3-1 (a) (Phase 155.2
 * plan 15) the row reader emits day 0, so the resolved series' first date IS this date for a
 * stored curve. It stays the one reading every list, percentile and SQL reader
 * (`returns_series->0->>date`) shares, and it still differs from the series start for a curve
 * at or above `STORED_CURVE_MAX_POINTS`, whose day 0 is not read. Null when the series is not curve-derived (`daily_returns` wins whenever it normalizes to
 * an entry, the same predicate `resolveDailyReturnSeries` applies), or when the first point carries
 * no date. The ONE helper the factsheet payload and the two Holdings producers (`queries.ts`) share,
 * so the record start cannot drift between them.
 */
export function curveRecordStart(dailyRaw: unknown, returnsSeriesRaw: unknown): string | null {
  if (normalizeDailyReturns(dailyRaw).length > 0) return null;
  if (!Array.isArray(returnsSeriesRaw)) return null;
  const first: unknown = returnsSeriesRaw[0];
  const date = first !== null && typeof first === "object" ? (first as { date?: unknown }).date : undefined;
  // WR-02: a present non-string date is kept as text (unreadable), as the SQL `->>` reads it; only
  // null / undefined / "" are absent.
  return date == null || date === "" ? null : String(date);
}
