import { annualizationPeriods, calendarYears, isRankableAnalyticsRow } from "@/lib/closed-sets";
import { sharpe as sharpeRatio } from "@/lib/return-stats";
import { headlineVerdict, storedCashHeadlineGate } from "@/lib/factsheet/headline-basis";

/**
 * Headline metrics for the dynamic OG factsheet card, extracted verbatim from
 * the inline computation that used to live in
 * `src/app/api/og/factsheet/[id]/route.tsx` so it is unit-testable in isolation.
 *
 * Contract:
 *  - Sharpe has NO card-only observation floor (Phase 164.6.6.3.3, D-06: "the
 *    card equals the factsheet"). Any minimum-history rule belongs in compute, so
 *    the card and the page cannot disagree about the same row. A series with no
 *    dispersion still has no Sharpe (`return-stats`), and that NaN is "—".
 *  - Sharpe rides the FREQUENCY clock: annualized on the strategy's asset-class
 *    basis (√365 crypto / √252 traditional) via `annualizationPeriods`. #597.
 *  - CAGR rides the CALENDAR clock (elapsed days / 365.25, asset-class-invariant)
 *    and is shown ONLY when the track spans ≥ 0.95 calendar years (exception E1,
 *    D-11) — a dense sub-year series (e.g. 300 trading days) is NOT enough.
 *    Otherwise NaN. A STORED CAGR is subject to E1 and E2 (below) and to nothing
 *    else; the positive-growth guard (`Math.pow` of a non-positive base is
 *    undefined) protects only a CAGR the card COMPUTES because the embed did not
 *    carry the key (B10).
 *  - maxDd is the peak-to-trough drawdown over the finite-value series, measured
 *    on at least two finite values; fewer is NaN, never a measured-looking 0.
 *  - NaN is the sentinel the card renders as "—" (hide). All three default to NaN.
 *
 * `date` is typed `unknown` because the source is a raw JSONB `daily_returns`
 * row: the calendar span is derived only from rows whose `date` is genuinely a
 * string (the `typeof` guard below), so a numeric/absent date is silently
 * excluded from the CAGR span rather than coerced — byte-identical to the route.
 *
 * Phase 169.4.1 OGSHARPE (SC4, D-10, D-25: "calculate Sharpe once; every page
 * reads it"): `persisted` is the analytics row's stored `sharpe` / `cagr` /
 * `max_drawdown` with its `computation_status`. For a RANKABLE row
 * (`isRankableAnalyticsRow`, the predicate the factsheet headline and the lists
 * gate on) each stored figure replaces the computed one, so the card shows the
 * value every other surface shows. Per figure: a key PRESENT with a finite number
 * is used; PRESENT with null (or anything non-finite) hides (NaN), never the
 * recomputed value; ABSENT (undefined, a caller that did not project it) keeps the
 * computed value. A non-rankable row is never read (a failed run leaves the
 * previous run's scalars behind), and the shared `sharpe(...)` below stays the
 * only Sharpe computation.
 *
 * Phase 164.6.6.3.3 (D-03, D-06): a chain-broken row with no valid
 * `data_quality_flags.headline_since` is a LEGACY mixed-basis row. The factsheet
 * read path withholds all seven of its stored scalars (`readHeadlineBasis`,
 * "Withheld"), so the card, which shows exactly the factsheet's value, withholds
 * the three it prints: Sharpe, Max DD and CAGR are all NaN, never the computed
 * value in their place. A Dated row (valid `headline_since`) shows its stored
 * Sharpe and Max DD, as the strip does.
 *
 * The card keeps exactly two NAMED CAGR differences from the factsheet (D-11), and
 * the parity test (`route.stored-parity.test.tsx`) enumerates them:
 *  - E1: a span under 0.95 calendar years. The card will not annualize a short
 *    record; the factsheet still prints its stored CAGR.
 *  - E2 (169.4.1 review round 1, CR-01 / SFH-01, the D-46 chain-broken rule): the
 *    stored CAGR can cover a SHORTER span than the card's resolved series, which
 *    covers the whole record. The analytics service annualizes it over the suffix
 *    after the last interior TWR chain break only, however short that suffix is,
 *    and flags it through `data_quality_flags`. So when the row carries
 *    `twr_chain_broken: true` (or `insufficient_window: true`, a suffix under 90
 *    days) the card HIDES the stored CAGR. The factsheet shows the same figure
 *    with a "headline covers from <date>" caveat; the card has no room for that
 *    caveat. Sharpe and max drawdown are unaffected, and a computed CAGR (stored
 *    key absent) covers the full series, so the flags do not apply to it.
 *
 */
export type OgPersistedScalars = {
  sharpe?: unknown;
  cagr?: unknown;
  max_drawdown?: unknown;
  computation_status?: unknown;
  /** `strategy_analytics.data_quality_flags` (JSONB); read the same way as
   *  `composite-read-path.ts` does, `=== true` per flag. */
  data_quality_flags?: unknown;
  /** `strategy_analytics.metrics_json_by_basis` (JSONB). SFH-R2-01: with the seven
   *  stored headline keys (`cumulative_return`, `volatility`, `max_drawdown`, `cagr`,
   *  `sharpe`, `sortino`, `calmar`) it lets the card ask the page's own question,
   *  `storedCashHeadlineGate`: is the stored cash headline applicable? The embed's
   *  keys are carried as PostgREST answered them: a key the select did not project
   *  is ABSENT, not undefined-valued. */
  metrics_json_by_basis?: unknown;
  cumulative_return?: unknown;
  volatility?: unknown;
  sortino?: unknown;
  calmar?: unknown;
};

export function computeOgHeadline(
  rows: ReadonlyArray<{ date: unknown; value: number }>,
  assetClass: string | null | undefined,
  persisted?: OgPersistedScalars | null,
): { sharpe: number; cagr: number; maxDd: number } {
  let sharpe = NaN;
  let cagr = NaN;
  let maxDd = NaN;

  const status = persisted?.computation_status;
  const stored = isRankableAnalyticsRow({ computation_status: typeof status === "string" ? status : null })
    ? persisted
    : undefined;
  // D-03 / SFH-R2-01: the verdict is the page's own (`headlineVerdict`, the call
  // `applyHeadlineBasis` makes), fed the page's own applicability gate
  // (`storedCashHeadlineGate`) and the flags of the row as it is, whether or not it
  // is rankable. A chain-broken row is Withheld when its stored headline carries no
  // valid `headline_since` OR is not applicable to the page at all (not rankable, a
  // raw `cash_settlement` object, unprojected keys): the card would otherwise
  // compute its figures from the whole-record series across the break. The factsheet
  // withholds the seven stored scalars, so the card withholds the three it prints.
  const gate = storedCashHeadlineGate(persisted, persisted?.metrics_json_by_basis, status);
  if (headlineVerdict(persisted?.data_quality_flags, gate, status).kind === "withheld") {
    return { sharpe, cagr, maxDd };
  }
  // E2 (CR-01): the stored CAGR's own span may be a post-chain-break suffix the
  // card's full-series span cannot see (docblock above). Hide rather than show it.
  const dqf = stored?.data_quality_flags as
    | { insufficient_window?: unknown; twr_chain_broken?: unknown }
    | null
    | undefined;
  const storedCagrCoversSuffixOnly =
    dqf?.twr_chain_broken === true || dqf?.insufficient_window === true;

  // Keep date+value together so the CAGR calendar span is derived from the SAME
  // finite-value rows that feed the risk metrics — a value-only filter would
  // desync the date axis.
  const finite = rows.filter(r => Number.isFinite(r.value));
  const values = finite.map(r => r.value);

  // #597 — risk metrics ride the FREQUENCY clock: annualize the headline
  // Sharpe on the strategy's asset-class basis (√365 crypto / √252
  // traditional). CAGR has no periods-per-year knob — it rides the CALENDAR
  // clock (elapsed days / 365.25) and is asset-class-invariant. Matches
  // compute.ts and metrics.py (TWR-05).
  const periodsPerYear = annualizationPeriods(assetClass);
  // Population sd through the shared module: a residue sd (a compounding
  // constant yield) is no dispersion, so the card hides the Sharpe exactly as
  // for an all-zero series (Phase 166.1 D-07). NaN is the card's hide value.
  sharpe =
    stored?.sharpe !== undefined
      ? storedFigure(stored.sharpe)
      : (sharpeRatio(values, { periodsPerYear, ddof: 0 }) ?? NaN);

  let cum = 1;
  let peak = 1;
  let dd = 0;
  for (const r of values) {
    cum *= 1 + r;
    if (cum > peak) peak = cum;
    const cur = cum / peak - 1;
    if (cur < dd) dd = cur;
  }
  // A drawdown needs at least two observations to be a measurement; fewer is no
  // measurement, not a flat 0.
  maxDd =
    stored?.max_drawdown !== undefined ? storedFigure(stored.max_drawdown) : values.length >= 2 ? dd : NaN;

  // CAGR on the CALENDAR span, not the observation count: a sparse-but-
  // year-long tradfi series qualifies; a dense 300-trading-day crypto series
  // still does not (E1: years >= 0.95).
  const times = finite
    .map(r => (typeof r.date === "string" ? Date.parse(r.date) : NaN))
    .filter(t => Number.isFinite(t));
  if (times.length >= 2) {
    const years = calendarYears(Math.min(...times), Math.max(...times));
    if (years >= 0.95) {
      if (stored?.cagr !== undefined) {
        // B10: a STORED CAGR is subject to E1 and E2 only. Whatever the series'
        // own cumulative growth, the stored figure never passes through it.
        cagr = storedCagrCoversSuffixOnly ? NaN : storedFigure(stored.cagr);
      } else if (cum > 0) {
        // The computed fallback: `Math.pow` of a non-positive base is undefined.
        cagr = Math.pow(cum, 1 / years) - 1;
      }
    }
  }

  return { sharpe, cagr, maxDd };
}

/** A stored figure as the card renders it: a finite number, else NaN ("—"),
 *  the same rule as the factsheet's strict overlay (`overlayBasisScalars`). */
function storedFigure(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : NaN;
}
