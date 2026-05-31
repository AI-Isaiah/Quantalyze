/**
 * dateday — calendar-day arithmetic on a branded `IsoDay` ("YYYY-MM-DD").
 *
 * B12 (Time / Date / Cadence Discipline). ONE module so the UTC-vs-local-
 * midnight off-by-one becomes unrepresentable:
 *
 *   - `NEW-C23-01` / `NEW-C23-02` — the CustomRangePicker built its `min` from a
 *     UTC-midnight epoch but compared cells with local-time accessors, so the
 *     first data day was unselectable for users east of UTC; `max = new Date()`
 *     carried wall-clock time, making day counts time-of-day-dependent.
 *   - `H-1224` — EquityChart's picker `min` had to be built in the SAME
 *     local-midnight convention the picker reads it with, NOT a UTC epoch.
 *
 * An `IsoDay` is a CALENDAR DAY, not a `Date` instant carrying wall-clock time.
 * To turn a day into a concrete instant you must say WHICH midnight you mean —
 * `localMidnight(day)` (the picker grid, which reads `Date` with local-time
 * accessors) or `utcEpoch(day)` (timezone-stable chart x-axis / period / sort
 * math). The two conversions are distinct functions, so the H-1224 mistake of
 * silently reading a UTC epoch through local accessors cannot recur.
 *
 * Lexicographic ordering of "YYYY-MM-DD" strings equals chronological ordering,
 * which is why the day-series helpers (`sortByDayAscending`, `isMonotonicByDay`,
 * `assertMonotonic`) compare the raw strings directly and are timezone-free.
 */

const DAY_MS = 86_400_000;

/**
 * A validated calendar day in "YYYY-MM-DD" form, anchored to no particular
 * timezone until converted via `localMidnight` / `utcEpoch`. The brand makes a
 * raw string un-assignable where a checked day is required.
 */
export type IsoDay = string & { readonly __brand: "IsoDay" };

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Validate + brand a "YYYY-MM-DD" string. Rejects rollover-prone garbage
 * (`2024-13-01`, `2024-02-31`) so a malformed input can never be silently
 * coerced into a real-but-wrong day (`H-1231`): JS rolls out-of-range
 * components over (`new Date(2024, 12, 1)` → Jan 2025; `new Date(2024, 1, 31)`
 * → Mar 2). Returns the normalized branded day, or `null` for anything that is
 * not a genuine calendar day.
 */
export function parseIsoDay(s: string): IsoDay | null {
  const [y, m, d] = s.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return null;
  }
  // Reject semantically out-of-range components up front; the Date constructor
  // would otherwise roll them over and hand back a day nobody supplied.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Round-trip check catches rollovers that survive the range gate — e.g. a
  // non-existent calendar day like Feb 31 (→ Mar 2). If the constructed local
  // date does not echo the requested components, the input was invalid.
  const probe = new Date(y, m - 1, d);
  if (
    probe.getFullYear() !== y ||
    probe.getMonth() !== m - 1 ||
    probe.getDate() !== d
  ) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}` as IsoDay;
}

/**
 * Format a `Date`'s LOCAL calendar fields as an `IsoDay`. Uses local accessors
 * (`getFullYear`/`getMonth`/`getDate`), NOT `getUTC*` — the picker grid holds
 * `Date` objects in local time, so the serialized day must read them locally
 * or it drifts a day for users away from UTC.
 */
export function isoDayFromDate(d: Date): IsoDay {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` as IsoDay;
}

/**
 * A day as a LOCAL-midnight `Date`. Use for the picker bounds / grid, which
 * compare cells with local-time accessors. Reading this through `getUTC*` would
 * reintroduce the H-1224 off-by-one.
 */
export function localMidnight(day: IsoDay): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * A day as a UTC-midnight epoch (ms). Use for all timezone-stable math — chart
 * x-axis scaling, period slicing, day diffs, event sorting — where the same
 * input must map to the same instant regardless of the viewer's timezone.
 */
export function utcEpoch(day: IsoDay): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Today as a LOCAL calendar day. */
export function today(): IsoDay {
  return isoDayFromDate(new Date());
}

/**
 * Today at LOCAL midnight as a `Date` — the picker `max` bound. NOT
 * `new Date()` (which carries the current wall-clock time and produces
 * time-of-day-dependent day counts when mixed with a local-midnight `min`).
 */
export function localMidnightToday(): Date {
  return localMidnight(today());
}

/**
 * Calendar-day count from `a` to `b` (b − a), immune to DST and time-of-day.
 * Both ends are resolved at UTC midnight so the result is always an integer
 * number of days; negative when `b` precedes `a`.
 */
export function diffDays(a: IsoDay, b: IsoDay): number {
  return Math.round((utcEpoch(b) - utcEpoch(a)) / DAY_MS);
}

/**
 * Lenient "YYYY-MM-DD" → UTC-midnight epoch (ms) for data-plane series that
 * trust their producer (the chart's daily points). Mirrors the historical
 * `EquityChart.parseISO` body exactly, INCLUDING its rollover tolerance
 * (`Date.UTC(2024, 12, 1)` → Jan 2025) and its `new Date(s)` fallback for
 * non-ISO inputs — so routing the chart through this is byte-for-byte
 * equivalent. Returns `NaN` for truly malformed input (callers guard on
 * `Number.isFinite` and surface a breadcrumb). For checked UI input that must
 * REJECT rollovers, use `parseIsoDay` + `utcEpoch` instead.
 */
export function utcEpochFromIsoString(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return Date.UTC(y, m - 1, d);
  }
  return new Date(s).getTime();
}

/**
 * Lenient "YYYY-MM-DD" → LOCAL-midnight `Date` for data-plane series that trust
 * their producer (the chart's picker `min` bound). The local sibling of
 * `utcEpochFromIsoString`: it mirrors the historical `EquityChart.localDateFromISO`
 * valid path exactly — `new Date(y, m - 1, d)` for finite parts, INCLUDING its
 * rollover tolerance — so routing the chart through it is byte-identical.
 * Returns `null` for non-ISO input (the caller supplies its own fallback). For
 * checked UI input that must REJECT rollovers, use `parseIsoDay` + `localMidnight`.
 *
 * Co-located with `utcEpochFromIsoString` on purpose: seeing the local and UTC
 * conversions side by side is what prevents the H-1224 mistake of building a
 * picker bound from a UTC epoch and reading it through local accessors.
 */
export function localMidnightFromIsoString(s: string): Date | null {
  const [y, m, d] = s.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return new Date(y, m - 1, d);
  }
  return null;
}

/**
 * Stable defensive sort of a day-keyed series, ascending. Lexicographic string
 * compare on "YYYY-MM-DD" is chronological and timezone-free. Returns a copy;
 * the input is not mutated.
 */
export function sortByDayAscending<T extends { date: string }>(series: T[]): T[] {
  return [...series].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
}

/**
 * True when `series` is non-decreasing by day (duplicates allowed). A fast
 * O(n) scan with no allocation — use to gate a defensive `sortByDayAscending`
 * only when needed.
 */
export function isMonotonicByDay<T extends { date: string }>(series: T[]): boolean {
  for (let i = 1; i < series.length; i++) {
    if (series[i].date < series[i - 1].date) return false;
  }
  return true;
}

/**
 * Assert a day-keyed series is chronologically ordered, returning it unchanged
 * on success. THROWS on the first violation — use at trust boundaries / in
 * tests where out-of-order input is a producer bug that must fail loudly. For
 * already-shipped render data that must never crash, prefer
 * `isMonotonicByDay` + `sortByDayAscending` (defensive sort) instead.
 *
 * `strict` (default `true`) rejects equal adjacent days too; pass `false` to
 * allow duplicates (non-decreasing).
 */
export function assertMonotonic<T extends { date: string }>(
  series: T[],
  strict = true,
): T[] {
  for (let i = 1; i < series.length; i++) {
    const violation = strict
      ? series[i].date <= series[i - 1].date
      : series[i].date < series[i - 1].date;
    if (violation) {
      throw new Error(
        `monotonic-date violation at index ${i}: ${series[i - 1].date} → ${series[i].date}`,
      );
    }
  }
  return series;
}
