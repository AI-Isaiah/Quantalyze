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
  // growth" default (as for empty input). Such upstream corruption is already
  // surfaced loudly by the sibling stats that consume the same returns
  // (computeReturnDistribution / findMinMax warnDroppedNonFinite), so a silent
  // neutralization here does not hide it at the system level.
  if (Number.isNaN(result)) return 0;
  if (!Number.isFinite(result)) return result > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE;
  return result;
}
