/**
 * Shared portfolio math primitives.
 *
 * Canonical home for the DailyPoint type, the normalizeDailyReturns
 * parser, and small numeric helpers (mean, stdDev, compound) used
 * across the analytics stack. Other modules re-export from here so
 * existing import paths remain stable.
 */

// ── Types ───────────────────────────────────────────────────────────
export interface DailyPoint {
  date: string;
  value: number;
}

// ── Normalizer ──────────────────────────────────────────────────────
/**
 * Normalize the analytics.daily_returns JSONB into a flat
 * { date, value }[] series. Handles three real-world shapes: already
 * an array, a flat {date: value} dict, and a nested {year: {MM-DD: value}}
 * dict. The nested case zero-pads MM-DD components so lexicographic
 * sorting aligns with every other strategy's dates.
 */
export function normalizeDailyReturns(raw: unknown): DailyPoint[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (p): p is DailyPoint =>
          p !== null &&
          typeof p === "object" &&
          "date" in p &&
          "value" in p &&
          typeof (p as DailyPoint).date === "string" &&
          Number.isFinite((p as DailyPoint).value),
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const out: DailyPoint[] = [];
  const obj = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (Number.isFinite(v)) {
      out.push({ date: k, value: v as number });
    } else if (v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (Number.isFinite(vv)) {
          if (kk.length === 10) {
            out.push({ date: kk, value: vv as number });
          } else {
            const [mm = "", dd = ""] = kk.split("-");
            const paddedMm = mm.padStart(2, "0");
            const paddedDd = dd.padStart(2, "0");
            out.push({ date: `${k}-${paddedMm}-${paddedDd}`, value: vv as number });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Analytics column-drift resolver ─────────────────────────────────
/**
 * Convert a wealth (equity) curve into the daily-return series. The input
 * carries wealth values (cumulative product of 1 + r); successive ratios
 * recover the daily-return series.
 *
 * Returns an empty array when the input has fewer than two points (the
 * factsheet builder bails on series length below 2 anyway).
 *
 * Note the first point has no predecessor and so yields no return — an
 * N-point curve produces N-1 returns.
 */
export function equityCurveToDailyReturns(points: DailyPoint[]): DailyPoint[] {
  if (!Array.isArray(points) || points.length < 2) return [];
  const sorted = [...points]
    .filter(
      (p) =>
        p &&
        typeof p.date === "string" &&
        Number.isFinite(p.value) &&
        p.value > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: DailyPoint[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].value;
    const curr = sorted[i].value;
    if (prev > 0 && Number.isFinite(curr)) {
      out.push({ date: sorted[i].date, value: curr / prev - 1 });
    }
  }
  return out;
}

/**
 * Resolve an analytics row's return series into the daily-return shape every
 * consumer expects, handling the analytics-service column drift.
 *
 * The analytics-service writes the cumprod equity curve to
 * `strategy_analytics.returns_series`; the `daily_returns` column is only
 * populated by CSV ingest. Analytics-only strategies leave `daily_returns`
 * null, so reading it alone strands the caller on an empty series even though
 * the real one exists in `returns_series`. Try the daily-return column first
 * (cheaper, no derivation), fall back to deriving from the wealth curve.
 *
 * Lives here rather than in `@/lib/factsheet/allocator-portfolio-payload`
 * (which re-exports it for its existing importers) because that module pulls
 * `build-payload` — and with it the bundled BTC/SPX/ETH/GLD/IEF benchmark
 * series — into any graph that touches it. The API route that serves the
 * scenario composer's lazy returns needs THIS resolver and none of that.
 */
export function resolveDailyReturnSeries(
  dailyReturnsRaw: unknown,
  returnsSeriesRaw: unknown,
): DailyPoint[] {
  const direct = normalizeDailyReturns(dailyReturnsRaw);
  if (direct.length > 0) return direct;
  return equityCurveToDailyReturns(normalizeDailyReturns(returnsSeriesRaw));
}

// ── Numeric helpers ─────────────────────────────────────────────────
/** Arithmetic mean. Returns 0 for an empty array. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * Standard deviation.
 * @param sample  When true (default), divides by n-1 (Bessel's correction).
 *                Pass false for population std (divides by n).
 */
export function stdDev(values: number[], sample = true): number {
  const n = values.length;
  if (n < 2 && sample) return 0;
  if (n === 0) return 0;
  const m = mean(values);
  const sumSq = values.reduce((s, v) => s + (v - m) * (v - m), 0);
  return Math.sqrt(sumSq / (sample ? n - 1 : n));
}

/**
 * Compound a sequence of period returns.
 * Returns the total return: product of (1 + r_i) - 1.
 * An empty array returns 0 (no growth).
 */
export function compound(returns: number[]): number {
  if (returns.length === 0) return 0;
  let product = 1;
  for (const r of returns) product *= 1 + r;
  const result = product - 1;
  // H-0469: never return a non-finite value. JSON.stringify(±Infinity|NaN) ===
  // 'null' (RFC 8259 §6), so callers that ship compound() output to the client
  // (computeMonthlyReturns/computeAnnualReturns → {date, value}) would silently
  // emit value:null — a number-typed field that lies over the wire. Two ways to
  // go non-finite: (1) even all-finite inputs can overflow the running product
  // to ±Infinity (e.g. compound([1e308, 1e308])) → clamp to the signed
  // representable extreme; (2) a corrupt non-finite return (NaN/Infinity in the
  // series) poisons the product to NaN → return 0, this lib's neutral "no
  // growth" default (as for empty input). The NaN arm is silent (no warn) — and
  // unreachable today: compound()'s only live caller (AlphaBetaDecomposition)
  // feeds it values already finite-filtered by normalizeDailyReturns, and the
  // computeMonthlyReturns/computeAnnualReturns paths that pass raw values have
  // no production caller. So this is a forward-looking JSON-safety guard, not a
  // mask over a live corruption path; if a future caller wires raw daily values
  // straight into compound() without a finite-filter, add a warn breadcrumb here.
  if (Number.isNaN(result)) return 0;
  if (!Number.isFinite(result)) return result > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
  return result;
}
