import { annualizationPeriods, calendarYears } from "@/lib/closed-sets";

/**
 * Headline metrics for the dynamic OG factsheet card, extracted verbatim from
 * the inline computation that used to live in
 * `src/app/api/og/factsheet/[id]/route.tsx` so it is unit-testable in isolation.
 *
 * Contract (unchanged from the route):
 *  - Sharpe needs ≥ 30 finite observations; below that it is NaN ("hide").
 *  - Sharpe rides the FREQUENCY clock: annualized on the strategy's asset-class
 *    basis (√365 crypto / √252 traditional) via `annualizationPeriods`. #597.
 *  - CAGR rides the CALENDAR clock (elapsed days / 365.25, asset-class-invariant)
 *    and is shown ONLY when the track spans ≥ 0.95 calendar years AND cumulative
 *    growth is strictly positive (Math.pow of a non-positive base is undefined) —
 *    a dense sub-year series (e.g. 300 trading days) is NOT enough. Otherwise NaN.
 *  - maxDd is the peak-to-trough drawdown over the finite-value series.
 *  - NaN is the sentinel the card renders as "—" (hide). All three default to NaN.
 *
 * `date` is typed `unknown` because the source is a raw JSONB `daily_returns`
 * row: the calendar span is derived only from rows whose `date` is genuinely a
 * string (the `typeof` guard below), so a numeric/absent date is silently
 * excluded from the CAGR span rather than coerced — byte-identical to the route.
 */
export function computeOgHeadline(
  rows: ReadonlyArray<{ date: unknown; value: number }>,
  assetClass: string | null | undefined,
): { sharpe: number; cagr: number; maxDd: number } {
  let sharpe = NaN;
  let cagr = NaN;
  let maxDd = NaN;

  // Keep date+value together so the CAGR calendar span is derived from the SAME
  // finite-value rows that feed the risk metrics — a value-only filter would
  // desync the date axis.
  const finite = rows.filter(r => Number.isFinite(r.value));
  const values = finite.map(r => r.value);

  // Sharpe only needs ~30 obs to be meaningful; CAGR requires a full CALENDAR
  // year of history (the elapsed-year gate below) since annualizing a sub-year
  // track ships nonsense on social cards.
  if (values.length >= 30) {
    // #597 — risk metrics ride the FREQUENCY clock: annualize the headline
    // Sharpe on the strategy's asset-class basis (√365 crypto / √252
    // traditional). CAGR has no periods-per-year knob — it rides the CALENDAR
    // clock (elapsed days / 365.25) and is asset-class-invariant. Matches
    // compute.ts and metrics.py (TWR-05).
    const periodsPerYear = annualizationPeriods(assetClass);
    const m = values.reduce((a, x) => a + x, 0) / values.length;
    const v = values.reduce((a, x) => a + (x - m) ** 2, 0) / values.length;
    const s = Math.sqrt(v);
    sharpe = s > 0 ? (m * periodsPerYear) / (s * Math.sqrt(periodsPerYear)) : NaN;

    let cum = 1;
    let peak = 1;
    let dd = 0;
    for (const r of values) {
      cum *= 1 + r;
      if (cum > peak) peak = cum;
      const cur = cum / peak - 1;
      if (cur < dd) dd = cur;
    }
    maxDd = dd;

    // CAGR on the CALENDAR span, not the observation count: a sparse-but-
    // year-long tradfi series qualifies; a dense 300-trading-day crypto series
    // still does not. Gate on years ≥ 0.95 (≈ a full calendar year) and cum > 0.
    const times = finite
      .map(r => (typeof r.date === "string" ? Date.parse(r.date) : NaN))
      .filter(t => Number.isFinite(t));
    if (times.length >= 2 && cum > 0) {
      const years = calendarYears(Math.min(...times), Math.max(...times));
      if (years >= 0.95) {
        cagr = Math.pow(cum, 1 / years) - 1;
      }
    }
  }

  return { sharpe, cagr, maxDd };
}
