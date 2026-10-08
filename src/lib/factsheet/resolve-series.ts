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
 * Convert a stored cumulative curve into the daily-return series the
 * FactsheetPayload builder expects. The points are sorted by date and then
 * paired by STORED adjacency, without filtering first:
 *
 *   geometric:  r_k = w_k / w_{k-1} - 1   both levels finite and > 0
 *   simple:     r_k = w_k - w_{k-1}       both levels finite
 *
 * Day 0 never emits (no stored predecessor). A day whose pair is unusable is
 * ABSENT: never 0, never carried, and never bridged across the bad level (the
 * day after a bad level pairs with the bad level, so it is absent too). A
 * non-positive level is legal on the simple curve and unusable on the
 * geometric. Duplicate dates are not deduped here (the Python twin dedupes;
 * the shared oracle leaves that rule out).
 *
 * `analytics-service/services/wealth_returns.py` is the Python twin; both are
 * pinned to `analytics-service/tests/fixtures/wealth_to_returns_oracle.json`.
 *
 * Returns an empty array when the input has fewer than two points. The default
 * method is geometric, which is also what the allocator's own blended equity
 * wealth (a cumulative product of 1 + r) needs.
 *
 * `keepAbsent` (WR-02, 164.6.6.2.2 review): keep every absent day AFTER day 0 in
 * the output as a `NaN` placeholder at its own date instead of deleting it. The
 * one consumer is {@link convertNativeReturnsToUsd}, which prices a day's native
 * return by the BTC move over `[previous series date, this date]`: with the
 * absent day deleted that interval silently grew to span the whole gap, so a
 * one-day native return was multiplied by a multi-day price move. With the
 * placeholder kept, the converter skips the NaN day and prices the next day over
 * its own single interval. A series built this way carries NaN and MUST go
 * through the converter (which drops it), never into a blend or a payload.
 * Twin of `curve_to_daily_returns(keep_absent=True)`.
 */
export function equityCurveToDailyReturns(
  points: DailyPoint[],
  method: CurveMethod = "geometric",
  keepAbsent = false,
): DailyReturn[] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const sorted = points
    .filter((p) => p && typeof p.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: DailyReturn[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
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
 */
export function resolveDailyReturnSeries(
  dailyReturnsRaw: unknown,
  returnsSeriesRaw: unknown,
  method: CurveMethod = "geometric",
  keepAbsent = false,
): DailyReturn[] {
  const direct = normalizeDailyReturns(dailyReturnsRaw);
  if (direct.length > 0) return direct;
  return equityCurveToDailyReturns(normalizeCurve(returnsSeriesRaw), method, keepAbsent);
}
