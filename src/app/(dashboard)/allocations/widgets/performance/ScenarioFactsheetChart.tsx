"use client";

import { useMemo } from "react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import type {
  OwnBookDeltaPayload,
  PeerPercentilePayload,
  ScenarioMandatePayload,
} from "@/lib/factsheet/types";
import { FactsheetProvider, useXRange } from "@/app/factsheet/[id]/v2/factsheet-context";
import { FactsheetBody } from "@/app/factsheet/[id]/v2/FactsheetView";
import { buildScenarioFactsheetPayload } from "./scenario-factsheet-payload";

/**
 * ScenarioFactsheetChart — the composer-side mount that renders the scenario
 * blend through the REAL `FactsheetBody` (Phase 40, BODY-01). This is the "mount
 * the complete factsheet" goal: the scenario tab doesn't just LOOK like the
 * factsheet, it IS the real factsheet body fed a synthesized scenario payload,
 * so the blend gets every factsheet panel for free — parity-by-construction.
 *
 * Design contract:
 *   - BODY-01 (engine reuse): the synth payload from `buildScenarioFactsheetPayload`
 *     is mounted under the factsheet's own provider + the real `FactsheetBody`
 *     subtree (which itself renders MasterBrush + PerformanceCharts equity/drawdown
 *     via the real `chart-configs.ts` configs + every other panel). Wheel-zoom,
 *     drag-pan, brush, and keyboard navigation are inherited verbatim — nothing is
 *     reimplemented here.
 *   - Shared window: the body renders under ONE `FactsheetProvider`, so the
 *     MasterBrush, the ControlBar reset, and the composer's `PeriodControl` (in
 *     `topSlot`) all read the SAME `XRangeContext`. There is NO parallel xRange
 *     lifted in this wrapper — the single provider IS the shared-window mechanism.
 *   - scenarioMode (BODY-02): passed `true` so the ControlBar suppresses the
 *     Share-link + Compare-strategies actions (a hypothetical blend is not a
 *     shareable/comparable real strategy) and the MetricsColumn seam is threaded
 *     for the Phase-42 peer carve-out. The api-only panels (allocator / signatures
 *     / peer) stay absent by construction (ingestSource "csv"); `hideHeader` (the
 *     composer owns the title) and `hideAllocatorSection` (belt-and-suspenders) are
 *     passed; `hideFooter={false}` SHOWS the footer (USER OVERRIDE).
 *   - Q3 (period control): the 3M/6M/12M/ALL SegmentedControl is kept and drives
 *     the shared `xRange` via `setXRange` over the scenario date axis (NOT the
 *     legacy `sliceByPeriod`). It lives in the body's `topSlot` so it stays a
 *     provider descendant and `useXRange` resolves.
 *   - persist=false (T-38-03-01): a scenario pan on the dashboard tab never
 *     rewrites the allocator's URL (`?range=`) nor writes a `factsheet-v2:`
 *     localStorage blob. The factsheet never passes persist; only this mount does.
 *
 * The "PROJECTED — hypothetical" honesty pill and the "BTC Benchmark" toggle are
 * composer-owned chrome rendered by the call site AROUND this component — they
 * are NOT pushed into the factsheet engine.
 *
 * ⛔ The `FactsheetBody` mount lives EXCLUSIVELY in THIS file (which
 * ScenarioComposer.test.tsx mocks); `ScenarioComposer.tsx` must contain the
 * literal `FactsheetBody` ZERO times (static source guard: the
 * "no factsheet import on the blend path … (static guard, T-30-05)" test in
 * ScenarioComposer.test.tsx). Do NOT inline this mount into the composer.
 */

/** Window periods the SegmentedControl offers (Q3). "ALL" resets to full range. */
const SCENARIO_PERIODS = ["3M", "6M", "12M", "ALL"] as const;
type ScenarioPeriod = (typeof SCENARIO_PERIODS)[number];

/** Approximate trading-day span for each fixed period (252 trading days/year). */
const PERIOD_TRADING_DAYS: Record<Exclude<ScenarioPeriod, "ALL">, number> = {
  "3M": 63,
  "6M": 126,
  "12M": 252,
};

export interface ScenarioFactsheetChartProps {
  /**
   * @deprecated Live baseline series. No longer fed to the adapter (WR-01): the
   * synthesized payload is now SINGLE-AXIS off `portfolioDaily`, so a hypothetical
   * blend carries no live-baseline line. Accepted for call-site symmetry with the
   * composer (blank mode passes []) and documents the blank-slate contract
   * (PARITY-03); it does not affect the rendered chart.
   */
  equityDailyPoints: DailyPoint[];
  /**
   * @deprecated Scenario wealth series (toWealth-normalized, cumulative, ~1.0).
   * No longer the chart-line source (WR-01): the equity line is now
   * `cumEq(portfolioDaily)` — the same curve `equity_curve` downsamples, full-res
   * and unrounded — so `dates` indexes every returns/rolling panel by construction.
   * Accepted for call-site symmetry only.
   */
  scenarioSeries: DailyPoint[];
  /** Optional BTC benchmark overlay (cumulative-wealth form). Undefined hides it. */
  benchmark?: DailyPoint[];
  /**
   * The engine's `portfolio_daily_returns` — daily RETURN form (decimal). The
   * SINGLE input the adapter feeds to `compute()`/`cumEq` for the entire payload:
   * the `dates` axis, the chart line, the full scalar set, and every panel array
   * (WR-01, parity with `build-payload.ts`). Optional + defaults to [] →
   * safe-empty body (empty chart). When present (production always passes it),
   * the chart renders the full-resolution scenario line.
   */
  portfolioDaily?: DailyPoint[];
  /**
   * Phase 42 (PEER-01, ADR-0025) — the blend's live peer rank vs the REAL
   * verified universe, on the engine's sample/252 basis. The ONLY carve-out
   * field that flows onto the synthesized csv payload (it never flips
   * `ingestSource`; the three genuinely-synthetic api panels stay absent).
   * Optional + additive: omitted → `buildScenarioFactsheetPayload` produces a
   * byte-identical payload (the key is OMITTED, not undefined), so the peer
   * panel is absent. The composer supplies it only when the blend has
   * n>=252 obs AND the route returned a non-null rank (>= min-N cohort).
   */
  scenarioPeer?: PeerPercentilePayload;
  /**
   * Phase 42 (PEER-04, ADR-0025) — per-constituent mandate chips for the blend
   * (strategy_types + markets + per-constituent leverage), flowed onto the synth
   * csv payload. Additive + optional: omitted → byte-identical payload (the
   * ConstituentMandatePanel renders nothing). Composer-supplied from
   * `engineSet.strategies` + `engineSet.state.leverage`.
   */
  scenarioMandate?: ScenarioMandatePayload;
  /**
   * Phase 42 (PEER-05, ADR-0025) — the blend-vs-live-book signed delta on the
   * sample/252 basis. Additive + optional: omitted (no live book / blank mode) →
   * the OwnBookDeltaPanel is silently absent.
   */
  scenarioOwnBookDelta?: OwnBookDeltaPayload;
}

/**
 * Period SegmentedControl (Q3). Lives INSIDE the provider so it can call
 * `setXRange` to drive the shared window. Translates a fixed-period click into
 * an index window over the scenario date axis (most-recent N trading days);
 * "ALL" resets to the full range. The provider's `setXRange` clamps to
 * MIN_VISIBLE_SAMPLES, so a too-short series degrades safely.
 */
function PeriodControl({ axisLength }: { axisLength: number }) {
  const { setXRange, resetXRange } = useXRange();

  const selectPeriod = (period: ScenarioPeriod) => {
    if (period === "ALL" || axisLength <= 1) {
      resetXRange();
      return;
    }
    const days = PERIOD_TRADING_DAYS[period];
    const endIdx = axisLength - 1;
    const startIdx = Math.max(0, endIdx - days);
    setXRange([startIdx, endIdx]);
  };

  return (
    <div
      role="tablist"
      aria-label="Period"
      className="flex flex-wrap items-center gap-1"
    >
      {SCENARIO_PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          // No period is persisted as the active selection — the brush / xRange
          // is the source of truth (sticky state would desync the shared
          // window), so every period tab reports aria-selected={false}. Required
          // for the composer's WCAG-AA axe gate (a role="tab" must carry it).
          aria-selected={false}
          onClick={() => selectPeriod(p)}
          // Match the factsheet TimeSeriesChart tab recipe (the factsheet is the
          // source of truth): uppercase font-mono tracking-wider at the 10px tier
          // on a surface-subtle bordered pill. THREE deliberate class-literal
          // divergences from that recipe: (1) the factsheet pill is a FROZEN
          // island so it keeps raw `text-[10px]`; this non-frozen site uses the
          // byte-identical `text-fixed-10` token (BP-03). (2) the factsheet uses
          // `text-text-2`, but `--color-text-2`
          // is injected only on the `.factsheet-v2-shell` palette (palette.ts);
          // this chart mounts OUTSIDE that shell, so we use the globally-declared
          // `text-text-secondary` token (the same "primary > secondary > muted"
          // mid tier text-2 maps to) — keeping `text-text-2` here would resolve
          // to an undefined var and fall back to the inherited colour.
          // (3) `inline-flex min-h-6 items-center justify-center` raises the pill
          // to a 24px min height for WCAG 2.5.8 (Target Size Minimum) — the prior
          // `py-0.5` rendered ~21px on touch. This is a deliberate DIVERGENCE from
          // the frozen factsheet twin (which stays ~21px, un-editable pending its
          // own VERIFY-04 tolerance-golden re-bake); the two live on separate
          // pages so the cross-surface height difference is never seen side-by-side.
          className="inline-flex min-h-6 items-center justify-center rounded-sm border border-border bg-surface-subtle px-2 text-fixed-10 font-mono uppercase tracking-wider tabular-nums text-text-secondary hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          {p}
        </button>
      ))}
    </div>
  );
}

export function ScenarioFactsheetChart({
  // `equityDailyPoints` / `scenarioSeries` are accepted (call-site symmetry) but
  // no longer feed the adapter — the payload is SINGLE-AXIS off `portfolioDaily`
  // (WR-01). They are intentionally not destructured here.
  benchmark,
  portfolioDaily = [],
  scenarioPeer,
  scenarioMandate,
  scenarioOwnBookDelta,
}: ScenarioFactsheetChartProps) {
  // Synthesize the minimal, valid FactsheetPayload (csv arm) the factsheet
  // TimeSeriesChart + MasterBrush consume verbatim. SINGLE full-res returns axis
  // (WR-01): `dates`/equity/drawdowns/returns/panels all derive from
  // `portfolioDaily`. Memoized so a pan (which only churns xRange in context)
  // doesn't rebuild the payload.
  //
  // PEER-01: `scenarioPeer` is the ONLY carve-out field flowing onto the synth
  // csv payload — `buildScenarioFactsheetPayload` conditionally spreads it, so
  // an absent prop yields a byte-identical payload (no scenarioPeer key) and the
  // peer panel stays absent.
  const synthPayload = useMemo(
    () =>
      buildScenarioFactsheetPayload({
        benchmark: benchmark ?? null,
        portfolioDaily,
        scenarioPeer,
        scenarioMandate,
        scenarioOwnBookDelta,
      }),
    [benchmark, portfolioDaily, scenarioPeer, scenarioMandate, scenarioOwnBookDelta],
  );

  const axisLength = synthPayload.dates.length;

  return (
    // persist={false}: a scenario pan never rewrites the dashboard URL nor
    // writes a factsheet-v2: localStorage blob (T-38-03-01). ONE provider — the
    // body's MasterBrush + ControlBar + the topSlot PeriodControl all share it.
    <FactsheetProvider payload={synthPayload} persist={false}>
      {/* BODY-01: the REAL FactsheetBody replaces the Phase-38 two-chart subset.
          It renders MasterBrush + equity/drawdown (via the real chart-configs
          cumulative + underwaterAcc) + every other factsheet panel through the
          synthesized csv payload. scenarioMode suppresses the ControlBar
          Share-link + Compare-strategies actions and threads the MetricsColumn
          peer seam; hideHeader (composer owns the title), hideAllocatorSection
          (api-gated anyway), hideFooter={false} (SHOW the footer — USER OVERRIDE).
          The api-only panels (allocator / signatures / peer) stay absent by
          construction because the synth payload is ingestSource "csv". */}
      <FactsheetBody
        payload={synthPayload}
        scenarioMode
        hideHeader
        hideAllocatorSection
        hideFooter={false}
        topSlot={
          // Q3: the SegmentedControl drives the SHARED xRange via setXRange.
          // It lives in topSlot so it renders inside the <article> under the
          // provider — useXRange resolves. The data-testid hook (relocated here
          // from the old equity-chart wrapper) lets the shared-window + PARITY-03
          // tests find the composer's window control.
          <div
            data-testid="equity-chart-scenario-overlay"
            className="mb-1 flex items-center justify-end"
          >
            <PeriodControl axisLength={axisLength} />
          </div>
        }
      />
    </FactsheetProvider>
  );
}

export default ScenarioFactsheetChart;
