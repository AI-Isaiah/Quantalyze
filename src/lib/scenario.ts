/**
 * Scenario math — client-side portfolio analytics from raw daily returns.
 *
 * Extracted from `src/components/scenarios/ScenarioBuilder.tsx` in PR 3
 * of the My Allocation restructure so the exact same math can power both
 * the Scenario Builder page (unchanged behavior) and the Favorites panel
 * overlay on the My Allocation dashboard (new in PR 3/4).
 *
 * The core function `computeScenario` takes a set of strategies with
 * embedded daily-return series, a weights + include-from state object,
 * and a pre-built date-map cache, and returns a full set of portfolio
 * metrics: TWR, CAGR, volatility, Sharpe, Sortino, max drawdown, the
 * correlation matrix, and a cumulative equity curve.
 *
 * Behavior notes preserved verbatim from ScenarioBuilder:
 *
 *   1. Per-strategy "include from" dates are honored PER strategy. The
 *      merged date axis is the UNION of every active strategy's dates
 *      >= its own configured start. On days where a strategy isn't yet
 *      active, its return is zero-filled and the weight sum is
 *      renormalized so the active subset still sums to 1. This prevents
 *      the scenario from silently shrinking its window to the overlap
 *      when a late-inception strategy joins, and makes earlier
 *      include-from dates actually take effect.
 *
 *      v1.5 COVERAGE-WINDOW (ADR-001): behavior 1 above is the
 *      absent-`state.window` (UNION) path, preserved BYTE-IDENTICALLY for
 *      every own-book caller (queries.ts, computeCompositeCurve, share-
 *      resolve). When `state.window` is PRESENT (the scenario tab passes
 *      it explicitly), the engine instead blends over the CLOSED window
 *      `[winStart, winEnd]` with a CONSTANT divisor = member count:
 *        - member iff `enabled AND coverageSpanOf(returns) ⊇ window`
 *          (INCLUSIVE-CLOSED containment: `span.first <= winStart &&
 *          span.last >= winEnd`). An ENDED strategy (last < winEnd) is NOT
 *          a member and no longer divides the mean toward zero.
 *        - the divisor is constant across the window (window-fixed
 *          membership); interior mid-window gaps for a member 0-fill in
 *          the numerator ONLY (never outside the window, never for a
 *          non-member — that would reintroduce the tail dilution).
 *        - weighted blends renormalize the SURVIVING members' weights to
 *          sum-to-1 (typed `state.weights` stay the source of truth; the
 *          renorm is ephemeral, never mutates the caller's weights).
 *        - a ZERO-member window returns the honest empty-state shape
 *          (`member_count: 0`, null metrics, empty series) — no
 *          divide-by-zero, no fabricated flat-zero curve (no-invented-data).
 *      Coverage spans are derived INSIDE the engine from the returns maps
 *      via `scenario-window.ts`, never from `start_date` or the
 *      `"2022-01-01"` sentinel. Output exposes `member_count` /
 *      `member_ids` additively; `effective_start`/`effective_end` carry
 *      the window bounds and `n` carries N.
 *
 *   2. Correlation uses SAMPLE covariance (divide by n-1), consistent
 *      with the SAMPLE std used for portfolio volatility. Correlation
 *      between two identical series is 1.
 *
 *   3. Avg pairwise correlation is the average of ABSOLUTE correlations.
 *      A signed average would mask a book that's half strongly positive
 *      and half strongly negative as "diversified".
 *
 *   4. Sortino divides the downside RMS by TOTAL observations (n), not
 *      by the count of negative days. Dividing by downsides.length
 *      inflates Sortino during calm periods.
 *
 *   5. Equity curve is downsampled to every 5 business days for payload
 *      size, with the final point always included so the curve touches
 *      the effective_end date.
 *
 * Any change to these behaviors is a regression — unit tests in
 * `src/lib/scenario.test.ts` pin them (PR 3 scope).
 */

import type { DailyPoint } from "./portfolio-math-utils";
export type { DailyPoint } from "./portfolio-math-utils";
import { coverageSpanOf, covers } from "./scenario-window";

export interface StrategyForBuilder {
  id: string;
  name: string;
  codename: string | null;
  disclosure_tier: string;
  strategy_types: string[];
  markets: string[];
  start_date: string | null;
  daily_returns: DailyPoint[];
  cagr: number | null;
  sharpe: number | null;
  volatility: number | null;
  max_drawdown: number | null;
}

export interface ScenarioState {
  selected: Record<string, boolean>;
  weights: Record<string, number>; // 0..1 (or any non-negative — renormalized)
  startDates: Record<string, string>; // ISO date; strategy included from >= this
  /**
   * R4 — optional per-strategy leverage multiplier (id → L; default 1.0 when
   * absent). Applied as `wᵢ·Lᵢ·rᵢ` in the portfolio daily-return sum below, so
   * leverage scales exposure / return / vol / max-DD. Deliberately NOT applied
   * to the per-strategy series the correlation matrix is built from — leverage
   * is a scale transform and a single strategy's `L·r` has the SAME Pearson
   * correlations as `r` (it cancels in the std-normalised covariance). v1 models
   * leverage as daily-return scaling with NO borrow/funding cost, so risk-
   * adjusted metrics (Sharpe/Sortino) and the correlation matrix are leverage-
   * invariant — the UI must caveat that.
   *
   * Additive + optional: a state without `leverage` is byte-identical to the
   * pre-R4 behaviour, so every `scenario.test.ts` pin holds unchanged.
   */
  leverage?: Record<string, number>;
  /**
   * v1.5 COVERAGE-WINDOW (ADR-001) — an OPTIONAL explicit closed blend window
   * `[start, end]`. When PRESENT (the scenario tab derives it via
   * `defaultWindowFor()` and passes it in), `computeScenario` blends only
   * members whose coverage span ⊇ this window, with a constant divisor = the
   * member count (an ended strategy no longer dilutes the mean — the whole
   * point of v1.5). See the file-header behavior note.
   *
   * Additive + optional, but its byte-compat claim is CONDITIONAL (unlike
   * `leverage?`): a state WITHOUT `window` runs the legacy UNION path
   * byte-identically (the own-book callers queries.ts:2208/:2356,
   * computeCompositeCurve, and share-resolve pass no window and stay
   * unchanged — the `scenario.test.ts` "never shrinks to the overlap" pin
   * holds green). The NEW intersection behavior fires ONLY on the
   * present-`window` path.
   */
  window?: { start: string; end: string };
}

export interface ComputedMetrics {
  n: number;
  twr: number | null;
  cagr: number | null;
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: number | null;
  max_dd_days: number | null;
  correlation_matrix: Record<string, Record<string, number>> | null;
  avg_pairwise_correlation: number | null;
  /**
   * NEW-C18-09 (B1, audit-2026-05-07): cumulative **RETURN** form
   * (0.18 = +18%). `computeScenario` is the only producer that may
   * fill this field with engine output. Consumers that need cumulative
   * **wealth** form (1.18 = +18% from a $1 base) must convert via
   * `toWealth()` (re-exported from `@/lib/units`).
   *
   * The adapter that lifts a server-side wealth-form baseline into a
   * `ComputedMetrics`-shaped object (see
   * `liveBaselineToComputedMetrics` in `ScenarioComposer.tsx`) leaves
   * this field empty — a wealth-form array stored here would conflict
   * with the convention above and silently render mis-scaled charts.
   */
  equity_curve: Array<{ date: string; value: number }>;
  effective_start: string | null;
  effective_end: string | null;
  /**
   * BENCH-01 (Plan 24-01): the FULL-resolution daily portfolio-return series —
   * one point per common date, in cumulative-RETURN-per-day form (NOT wealth),
   * UNROUNDED (unlike the downsampled, 5-decimal-rounded `equity_curve` above).
   * This is the source the BTC benchmark inner-join aligns against; the
   * benchmark math needs every date at full precision, so do not round or
   * downsample it. Consumers needing wealth form convert separately.
   *
   * Declared OPTIONAL so it is fully additive: external `ComputedMetrics`
   * construction sites that this engine does not own — `liveBaselineTo
   * ComputedMetrics` (ScenarioComposer.tsx) and `NULL_METRICS`
   * (ScenarioComparePanel.tsx) — compile UNCHANGED and need no edit. They read
   * it with a `?? []` default. `computeScenario` itself ALWAYS sets it: to the
   * real series on the success path, or `[]` on every degenerate early-return
   * (no overlap rather than a false window). Consumers read it with `?? []`.
   */
  portfolio_daily_returns?: Array<{ date: string; value: number }>;
  /**
   * v1.5 COVERAGE-WINDOW (ADR-001, BLEND-06) — the blend DIVISOR and its
   * membership, exposed so consumers read the divisor rather than infer it.
   *
   * `member_count` is the number of strategies that participated in the blend:
   * on the present-`window` path it is the count of members whose coverage span
   * ⊇ the window (the CONSTANT divisor); on the absent-`window` union path it is
   * the active-set size (output completeness). `member_ids` lists those ids in
   * strategy order. `effective_start`/`effective_end` carry the window bounds
   * and `n` carries N.
   *
   * Declared OPTIONAL so both fields are fully additive: the external
   * `ComputedMetrics` construction sites this engine does NOT own —
   * `liveBaselineToComputedMetrics` (ScenarioComposer.tsx) and `NULL_METRICS`
   * (ScenarioComparePanel.tsx) — compile UNCHANGED and need no edit (mirroring
   * the `portfolio_daily_returns?` additive precedent). Consumers read them with
   * a `?? 0` / `?? []` default. `computeScenario` itself ALWAYS sets both: to the
   * real member set on every return path, or `0` / `[]` on the zero-member and
   * zero-selected empty-states.
   */
  member_count?: number;
  member_ids?: string[];
}

/**
 * Build a per-strategy lookup Map (strategy_id → (date → daily return)).
 * The caller memoizes this against the `strategies` array so toggling a
 * checkbox or scrubbing a weight input doesn't reallocate 15 Maps of ~1000
 * entries each on every recompute.
 */
export function buildDateMapCache(
  strategies: StrategyForBuilder[],
): Map<string, Map<string, number>> {
  const cache = new Map<string, Map<string, number>>();
  for (const s of strategies) {
    const m = new Map<string, number>();
    for (const d of s.daily_returns) m.set(d.date, d.value);
    cache.set(s.id, m);
  }
  return cache;
}

export function computeScenario(
  strategies: StrategyForBuilder[],
  state: ScenarioState,
  dateMapCache: Map<string, Map<string, number>>,
): ComputedMetrics {
  const activeIds = strategies
    .map((s) => s.id)
    .filter((id) => state.selected[id]);
  if (activeIds.length === 0) {
    return {
      n: 0,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: null,
      effective_end: null,
      portfolio_daily_returns: [],
      member_count: 0,
      member_ids: [],
    };
  }

  const activeStrategies = strategies.filter((s) => state.selected[s.id]);

  // v1.5 COVERAGE-WINDOW (ADR-001). When `state.window` is PRESENT, the blend
  // is over the CLOSED window `[winStart, winEnd]` with a constant divisor =
  // the count of MEMBERS (strategies whose coverage span ⊇ the window). When
  // ABSENT, the engine keeps its legacy UNION axis byte-identically (own-book
  // callers + computeCompositeCurve + share-resolve are untouched). `members`
  // and `axisBounds` below select the axis + divisor set for the two paths;
  // everything downstream (metrics block, correlation, curve) is shared and
  // unchanged.
  const window = state.window ?? null;

  // Members = the strategies that participate in the blend / divisor.
  //   - PRESENT window: enabled AND coverageSpanOf(returns) ⊇ window (INCLUSIVE-
  //     CLOSED containment via `covers`). An ended strategy (last < winEnd) or a
  //     ragged-head one (first > winStart) is EXCLUDED and no longer dilutes.
  //     Coverage is derived from the RETURNS array only (scenario-window.ts) —
  //     never `start_date` / the "2022-01-01" sentinel.
  //   - ABSENT window: every active strategy (the legacy union divisor set).
  const members: StrategyForBuilder[] = window
    ? activeStrategies.filter((s) => {
        const span = coverageSpanOf(s.daily_returns);
        return span !== null && covers(span, window);
      })
    : activeStrategies;

  // BLEND-05 (Pitfall 4): a zero-member window returns the honest empty-state
  // shape BEFORE the day loop — never reaching the `activeWeightSum > 0 ? … : 0`
  // fabrication that would emit a plausible flat-0% curve. Only fires on the
  // present-window path (absent-window `members === activeStrategies`, already
  // non-empty here).
  if (members.length === 0) {
    return {
      n: 0,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: null,
      effective_end: null,
      portfolio_daily_returns: [],
      member_count: 0,
      member_ids: [],
    };
  }
  const member_ids = members.map((s) => s.id);
  // Weight mass is summed over the MEMBER set (BLEND-04). On the absent-window
  // path `members === activeStrategies`, so this is byte-identical to the legacy
  // renorm over the active set. On the present-window path, a strategy dropped
  // for non-coverage is excluded from the denominator, so the SURVIVING members'
  // typed weights renormalize to sum-to-1 — WITHOUT mutating `state.weights`
  // (the renorm is ephemeral; typed weights stay the source of truth).
  const totalWeight = members.reduce(
    (s, x) => s + (state.weights[x.id] ?? 0),
    0,
  );
  const normWeight = (id: string) =>
    totalWeight > 0 ? (state.weights[id] ?? 0) / totalWeight : 0;

  // R4 — per-strategy leverage multiplier (default 1.0). A non-finite or
  // negative L falls back to 1.0 (no shorting in v1); the UI clamps to a
  // non-negative ceiling (MAX_LEVERAGE in ScenarioComposer), but the engine
  // stays defensive so a bad caller can't poison the curve.
  const lev = (id: string): number => {
    const L = state.leverage?.[id];
    return Number.isFinite(L) && (L as number) >= 0 ? (L as number) : 1;
  };

  // Per-strategy include-from.
  //   - PRESENT window: every member's include-from is `winStart` (the closed
  //     window lower bound). Members bracket the window by definition, so the
  //     axis below is exactly the window's trading days — no `startDates` /
  //     `start_date` / "2022-01-01" sentinel is consulted on this path (the
  //     coverage window is the authority; the sentinel is confined to the union
  //     path below).
  //   - ABSENT window: the legacy per-strategy include-from over the active set.
  const strategyStart = new Map<string, string>();
  if (window) {
    for (const s of members) {
      strategyStart.set(s.id, window.start);
    }
  } else {
    for (const s of activeStrategies) {
      const chosen = state.startDates[s.id] ?? s.start_date ?? "2022-01-01";
      strategyStart.set(s.id, chosen);
    }
  }

  // Merged date axis.
  //   - PRESENT window: the union of MEMBERS' dates that fall in the CLOSED
  //     window `[winStart, winEnd]`. Members bracket the window, so this is the
  //     full set of the window's trading days; a member missing an interior day
  //     leaves a gap that 0-fills in the numerator only (below), never shrinking
  //     the axis or the divisor (BLEND-03). Dates OUTSIDE the window are never
  //     added — 0-fill can never leak past the window (Pitfall 3).
  //   - ABSENT window: the legacy UNION of every active strategy's dates >= its
  //     own include-from (byte-identical).
  const allDateSet = new Set<string>();
  if (window) {
    for (const s of members) {
      for (const d of s.daily_returns) {
        if (d.date >= window.start && d.date <= window.end) {
          allDateSet.add(d.date);
        }
      }
    }
  } else {
    for (const s of activeStrategies) {
      const from = strategyStart.get(s.id)!;
      for (const d of s.daily_returns) {
        if (d.date >= from) allDateSet.add(d.date);
      }
    }
  }
  const commonDates = Array.from(allDateSet).sort();
  const n = commonDates.length;
  if (n < 10) {
    return {
      n,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: window ? window.start : commonDates[0] ?? null,
      effective_end: window ? window.end : commonDates[n - 1] ?? null,
      portfolio_daily_returns: [],
      member_count: members.length,
      member_ids,
    };
  }

  // Downstream loops iterate the MEMBER set. On the absent-window path
  // `members === activeStrategies`, so the axis / blend / correlation are
  // byte-identical to the legacy union behavior; on the present-window path
  // only covering members participate (constant divisor).
  const strategyReturns: Record<string, number[]> = {};
  for (const s of members) {
    const map = dateMapCache.get(s.id)!;
    const from = strategyStart.get(s.id)!;
    strategyReturns[s.id] = commonDates.map((d) =>
      d >= from ? (map.get(d) ?? 0) : 0,
    );
  }

  // Portfolio daily returns = weighted sum, with renormalization on days
  // where some strategies haven't started yet (absent-window path) or over
  // the constant member set (present-window path — divisor is constant, so
  // `activeWeightSum` sums the full member mass every day).
  const portDaily: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let activeWeightSum = 0;
    for (const s of members) {
      const from = strategyStart.get(s.id)!;
      if (commonDates[i] < from) continue;
      const w = normWeight(s.id);
      // R4 — leverage AMPLIFIES exposure: scale the return by Lᵢ in the
      // numerator but renormalize by the (un-levered) weight mass, so a 2x
      // strategy genuinely contributes 2x its return rather than cancelling.
      r += w * lev(s.id) * strategyReturns[s.id][i];
      activeWeightSum += w;
    }
    portDaily[i] = activeWeightSum > 0 ? r / activeWeightSum : 0;
  }

  // BENCH-01 (Plan 24-01): full-resolution daily portfolio-return series,
  // exact dates, UNROUNDED — the source the BTC benchmark inner-join aligns
  // against. Built from the same axis (commonDates) and weighted/renormalized/
  // leveraged returns (portDaily) the engine already computed above; the
  // benchmark math must NOT re-derive these (drift risk). Do not round or
  // downsample. Suppressed (→ []) on the degenerate early-returns above so a
  // degenerate scenario yields no false overlap window.
  const portfolio_daily_returns = commonDates.map((date, i) => ({
    date,
    value: portDaily[i],
  }));

  // Cumulative (full-resolution) used for TWR / CAGR / drawdown. Equity
  // curve output is downsampled below for payload size.
  const cumulative: number[] = new Array(n);
  let c = 1;
  for (let i = 0; i < n; i++) {
    c *= 1 + portDaily[i];
    cumulative[i] = c;
  }

  // Bug-guard: cumulative wealth must stay strictly positive AND
  // finite. Two failure modes are caught here:
  //
  //   1. Catastrophic single-day loss — any daily portfolio return
  //      ≤ -1 (i.e., -100% or worse, impossible for real long-only
  //      positions). Signals a data-quality issue: bad return units,
  //      mis-stamped returns_series, or a stablecoin price feed
  //      glitch. The wealth chain flips sign and downstream metrics
  //      (twr = wealth - 1, max_dd via wealth/peak - 1, sharpe via
  //      mean/std) become mathematically meaningless.
  //
  //   2. NaN / non-finite contamination — any daily_returns entry
  //      with NaN, Infinity, or -Infinity poisons the cumulative
  //      product. NaN is NEVER less-than any number under JS
  //      comparison, so a `minCumulative <= 0` check ALONE does
  //      not catch it (audit-2026-05-07 G8.E.7 / FIX-LIST P344).
  //      We additionally short-circuit if any cumulative value is
  //      not finite. Real-world: returns_series ingestion can
  //      occasionally produce NaN from upstream parser bugs.
  //
  // In either case, return null KPIs so the UI renders honest
  // em-dashes instead of astronomical garbage like -79,017% TWR.
  // The equity_curve is also suppressed because plotting nonsensical
  // values misleads more than empty state.
  let minCumulative = Infinity;
  let anyNonFinite = false;
  for (let i = 0; i < cumulative.length; i++) {
    const v = cumulative[i];
    if (!Number.isFinite(v)) {
      anyNonFinite = true;
      break;
    }
    if (v < minCumulative) minCumulative = v;
  }
  if (anyNonFinite || minCumulative <= 0) {
    return {
      n,
      twr: null,
      cagr: null,
      volatility: null,
      sharpe: null,
      sortino: null,
      max_drawdown: null,
      max_dd_days: null,
      correlation_matrix: null,
      avg_pairwise_correlation: null,
      equity_curve: [],
      effective_start: window ? window.start : commonDates[0],
      effective_end: window ? window.end : commonDates[n - 1],
      portfolio_daily_returns: [],
      member_count: members.length,
      member_ids,
    };
  }

  const twr = cumulative[n - 1] - 1;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(1 + twr, 1 / years) - 1 : null;

  // Vol (sample std), Sharpe (rf=0), Sortino (rf=0).
  const meanR = portDaily.reduce((s, r) => s + r, 0) / n;
  const variance =
    portDaily.reduce((s, r) => s + (r - meanR) * (r - meanR), 0) / (n - 1);
  const volDaily = Math.sqrt(variance);
  const volatility = volDaily * Math.sqrt(252);
  const sharpe = volatility > 0 ? (meanR * 252) / volatility : null;

  // Sortino: downside RMS divides by TOTAL observations (n), not by the
  // count of negative days. See the file-level behavior notes.
  //
  // audit-2026-05-07 G8.E.6 / FIX-LIST P343 — when downsideVol === 0
  // (a strategy with no down days in the window), the previous fallback
  // silently returned `sharpe ?? 0`. The KPI card then displayed e.g.
  // "Sortino: 1.42" when the value was actually Sharpe-relabeled, which
  // misleads an allocator making a real allocation decision.  Return
  // `null` so the UI renders "—" through its existing `formatNumber`
  // path; allocators interpret the dash as "insufficient data" rather
  // than the wrong metric.
  const downsideSumSq = portDaily.reduce(
    (s, r) => s + (r < 0 ? r * r : 0),
    0,
  );
  const downsideVar = downsideSumSq / n;
  const downsideVol = Math.sqrt(downsideVar) * Math.sqrt(252);
  const sortino: number | null =
    downsideVol > 0 ? (meanR * 252) / downsideVol : null;

  // Max drawdown + duration.
  let peak = cumulative[0];
  let maxDD = 0;
  let currentDuration = 0;
  let maxDuration = 0;
  for (let i = 0; i < n; i++) {
    if (cumulative[i] > peak) {
      peak = cumulative[i];
      currentDuration = 0;
    } else {
      currentDuration += 1;
    }
    const dd = cumulative[i] / peak - 1;
    if (dd < maxDD) maxDD = dd;
    if (currentDuration > maxDuration) maxDuration = currentDuration;
  }

  // Correlation matrix (Pearson on daily returns). Sample covariance
  // (n-1) to match the sample-std denominator above.
  const strategyStats = new Map<
    string,
    { mean: number; std: number; demeaned: number[] }
  >();
  for (const s of members) {
    const vec = strategyReturns[s.id];
    const mean = vec.reduce((sum, v) => sum + v, 0) / vec.length;
    const demeaned = vec.map((v) => v - mean);
    const sampleVar =
      vec.length > 1
        ? demeaned.reduce((sum, d) => sum + d * d, 0) / (vec.length - 1)
        : 0;
    strategyStats.set(s.id, {
      mean,
      std: Math.sqrt(sampleVar),
      demeaned,
    });
  }

  const correlation_matrix: Record<string, Record<string, number>> = {};
  let absCorrSum = 0;
  let corrCount = 0;
  for (let i = 0; i < members.length; i++) {
    const idA = members[i].id;
    correlation_matrix[idA] = {};
    const statA = strategyStats.get(idA)!;
    for (let j = 0; j < members.length; j++) {
      const idB = members[j].id;
      if (i === j) {
        correlation_matrix[idA][idB] = 1;
        continue;
      }
      const statB = strategyStats.get(idB)!;
      const T = statA.demeaned.length;
      let cov = 0;
      for (let k = 0; k < T; k++) {
        cov += statA.demeaned[k] * statB.demeaned[k];
      }
      cov = T > 1 ? cov / (T - 1) : 0;
      const corr =
        statA.std > 0 && statB.std > 0 ? cov / (statA.std * statB.std) : 0;
      correlation_matrix[idA][idB] = Number(corr.toFixed(3));
      if (j > i) {
        // Absolute values to match the "Avg |corr|" label.
        absCorrSum += Math.abs(corr);
        corrCount += 1;
      }
    }
  }
  const avg_pairwise_correlation =
    corrCount > 0 ? Number((absCorrSum / corrCount).toFixed(3)) : null;

  // Downsampled equity curve (weekly, every 5 business days).
  const equity_curve: Array<{ date: string; value: number }> = [];
  for (let i = 0; i < n; i += 5) {
    equity_curve.push({
      date: commonDates[i],
      value: Number((cumulative[i] - 1).toFixed(5)),
    });
  }
  if (equity_curve[equity_curve.length - 1]?.date !== commonDates[n - 1]) {
    equity_curve.push({
      date: commonDates[n - 1],
      value: Number((cumulative[n - 1] - 1).toFixed(5)),
    });
  }

  return {
    n,
    twr: Number(twr.toFixed(5)),
    cagr: cagr !== null ? Number(cagr.toFixed(5)) : null,
    volatility: Number(volatility.toFixed(5)),
    sharpe: sharpe !== null ? Number(sharpe.toFixed(3)) : null,
    sortino: sortino !== null ? Number(sortino.toFixed(3)) : null,
    max_drawdown: Number(maxDD.toFixed(5)),
    max_dd_days: maxDuration,
    correlation_matrix,
    avg_pairwise_correlation,
    equity_curve,
    // PRESENT window: the effective bounds ARE the window `[winStart, winEnd]`
    // (members bracket the window, so commonDates[0]/[n-1] equal the window
    // bounds anyway — but pin them explicitly to the window authority).
    // ABSENT window: the legacy union bounds (byte-identical).
    effective_start: window ? window.start : commonDates[0],
    effective_end: window ? window.end : commonDates[n - 1],
    portfolio_daily_returns,
    member_count: members.length,
    member_ids,
  };
}

/**
 * Compute a single strategy's cumulative equity curve from its daily
 * returns series. Returns full daily resolution (NOT downsampled) so the
 * multi-strategy chart on the My Allocation dashboard can align all lines
 * on the same date axis without interpolation.
 *
 * `value` is the cumulative wealth multiplier: 1.0 = flat, 1.18 = +18%,
 * matching the format PortfolioEquityCurve expects for its `strategies[]`
 * prop.
 */
export function computeStrategyCurve(
  dailyReturns: DailyPoint[],
): DailyPoint[] {
  let c = 1;
  const out: DailyPoint[] = new Array(dailyReturns.length);
  for (let i = 0; i < dailyReturns.length; i++) {
    c *= 1 + dailyReturns[i].value;
    out[i] = { date: dailyReturns[i].date, value: Number(c.toFixed(6)) };
  }
  return out;
}

// ---------------------------------------------------------------------------
// NEW-C04-03: branded WealthPoint type + toWealth() constructor.
//
// MUST live in this PURE (non-"use client") module, NOT in the EquityChart
// widget. EquityChart is `"use client"`; the public scenario-share page is a
// Server Component that calls `toWealth()` during server render. A function
// exported from a "use client" module throws "Attempted to call toWealth()
// from the server but toWealth() is on the client" when invoked server-side
// (a runtime RSC-boundary error → 500). Keeping the constructor here lets both
// the server page and the client chart import it; EquityChart re-exports it for
// its existing client-side importers.
//
// `computeScenario().equity_curve` produces cumulative RETURN values (e.g.
// 0.18 = +18%). The chart needs cumulative WEALTH (starting at ~1.0). Callers
// MUST convert via `toWealth()` before passing scenarioSeries; a raw
// DailyPoint[] fails to typecheck so the silent 0%-baseline miscompare is
// caught at compile time.
// ---------------------------------------------------------------------------

/** Branded DailyPoint in cumulative-WEALTH form (value starts near 1.0). */
export type WealthPoint = DailyPoint & { readonly __wealthBrand: true };

/**
 * Convert a cumulative-RETURN point to WEALTH form. Pass
 * `computeScenario().equity_curve` through this before forwarding to
 * `scenarioSeries`. A cheap boundary warn fires when the first value is < 0.05
 * (a reliable indicator of an unconverted RETURN-form array: return-form starts
 * near 0.0 = 0% cumulative gain, wealth-form starts near 1.0; a value strictly
 * < 0.05 means a –95%+ cumulative return at t=0, implausible for any dataset
 * that passes the leading-zero trim, so it reliably indicates a miscall).
 */
export function toWealth(points: DailyPoint[]): WealthPoint[] {
  if (points.length > 0 && points[0].value < 0.05) {
    if (typeof console !== "undefined") {
      console.warn(
        "[scenario] toWealth: first value < 0.05 — input is likely raw RETURN-form (not wealth). Did you forget to call toWealth() or add +1?",
        { first: points[0] },
      );
    }
  }
  return points.map((p) => ({ ...p, __wealthBrand: true as const }));
}

/**
 * Compute a weighted composite cumulative curve for a set of strategies
 * with explicit per-strategy weights. Thin wrapper over computeScenario
 * that skips the correlation/risk metrics and just returns the curve in
 * full daily resolution, suitable for direct rendering via
 * PortfolioEquityCurve.
 *
 * Used by the My Allocation page to render the real portfolio's composite
 * curve (no favorites, current weights) and by PR 4's Favorites panel to
 * render the "+ Favorites" overlay curve (real + toggled favorites with a
 * sleeve carved out of the book).
 *
 * `weightsById` maps strategy_id → weight (any non-negative; renormalized
 * internally by computeScenario). `inceptionDate` is the portfolio's
 * inception (typically portfolios.created_at) — every strategy defaults
 * to starting from this date, but if a strategy's own start_date is
 * later, its include-from is clamped to that later date so the overlay
 * never time-travels.
 */
export function computeCompositeCurve(
  strategies: StrategyForBuilder[],
  weightsById: Record<string, number>,
  inceptionDate: string,
  dateMapCache?: Map<string, Map<string, number>>,
): DailyPoint[] {
  if (strategies.length === 0) return [];

  const cache = dateMapCache ?? buildDateMapCache(strategies);
  const selected: Record<string, boolean> = {};
  const startDates: Record<string, string> = {};
  for (const s of strategies) {
    selected[s.id] = true;
    // Clamp to the later of inception and the strategy's own start_date
    // so a favorite that launched AFTER the allocator's portfolio was
    // created only contributes from its own launch date forward.
    const strategyStart = s.start_date ?? inceptionDate;
    startDates[s.id] =
      strategyStart > inceptionDate ? strategyStart : inceptionDate;
  }

  const metrics = computeScenario(
    strategies,
    { selected, weights: weightsById, startDates },
    cache,
  );

  // computeScenario returns the curve as cumulative RETURN (0.18 = +18%).
  // PortfolioEquityCurve expects cumulative WEALTH (1.18 = +18%). Convert
  // by adding 1 to each value.
  return metrics.equity_curve.map((p) => ({
    date: p.date,
    value: Number((p.value + 1).toFixed(6)),
  }));
}

