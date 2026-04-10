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
          typeof (p as DailyPoint).value === "number",
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  const out: DailyPoint[] = [];
  const obj = raw as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") {
      out.push({ date: k, value: v });
    } else if (v && typeof v === "object") {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (typeof vv === "number") {
          if (kk.length === 10) {
            out.push({ date: kk, value: vv });
          } else {
            const [mm = "", dd = ""] = kk.split("-");
            const paddedMm = mm.padStart(2, "0");
            const paddedDd = dd.padStart(2, "0");
            out.push({ date: `${k}-${paddedMm}-${paddedDd}`, value: vv });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Numeric helpers ─────────────────────────────────────────────────
/** Arithmetic mean. Caller must ensure `values` is non-empty. */
export function mean(values: number[]): number {
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
  return product - 1;
}
