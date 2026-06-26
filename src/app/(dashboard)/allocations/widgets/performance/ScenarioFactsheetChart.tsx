"use client";

import { useMemo } from "react";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { FactsheetProvider, useXRange } from "@/app/factsheet/[id]/v2/factsheet-context";
import { TimeSeriesChart } from "@/app/factsheet/[id]/v2/TimeSeriesChart";
import { MasterBrush } from "@/app/factsheet/[id]/v2/MasterBrush";
import {
  buildScenarioFactsheetPayload,
  SCENARIO_EQUITY_CONFIG,
  SCENARIO_DRAWDOWN_CONFIG,
} from "./scenario-factsheet-payload";

/**
 * ScenarioFactsheetChart — the composer-side mount that renders the scenario's
 * equity + drawdown through the REAL factsheet `TimeSeriesChart` + `MasterBrush`
 * engine (Phase 38, PARITY-01). This is the "factsheet component identity" half
 * of the convergence the governing principle demands: the scenario chart doesn't
 * just LOOK like the factsheet, it IS the factsheet engine fed a synthesized
 * scenario payload.
 *
 * Design contract:
 *   - Q1 (engine reuse): the synth payload from `buildScenarioFactsheetPayload`
 *     is mounted under the factsheet's own provider + charts. Wheel-zoom, drag-
 *     pan, brush, and keyboard navigation are inherited verbatim — nothing is
 *     reimplemented here.
 *   - Q4 (shared window): equity + drawdown mount under ONE `FactsheetProvider`,
 *     so they read the SAME `XRangeContext`. A pan/zoom on either panel (or the
 *     brush) moves both. There is NO parallel xRange lifted in this wrapper —
 *     the single provider IS the shared-window mechanism.
 *   - Q2 (color): scenario = accent strategy line, benchmark = muted comparator.
 *     Color flows through `resolveSeries` via the two exported ChartConfigs;
 *     this file inlines NO strokes or colors.
 *   - Q3 (period control): the 3M/6M/12M/ALL SegmentedControl is kept and drives
 *     the shared `xRange` via `setXRange` over the scenario date axis (NOT the
 *     legacy `sliceByPeriod`). It must live INSIDE the provider to call
 *     `useXRange`, so it's a small child rendered alongside the brush.
 *   - persist=false (T-38-03-01): a scenario pan on the dashboard tab never
 *     rewrites the allocator's URL (`?range=`) nor writes a `factsheet-v2:`
 *     localStorage blob. The factsheet never passes persist; only this mount does.
 *
 * The "PROJECTED — hypothetical" honesty pill and the "BTC Benchmark" toggle are
 * composer-owned chrome rendered by the call site AROUND this component — they
 * are NOT pushed into the factsheet engine.
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
          // Match the factsheet TimeSeriesChart tab recipe verbatim (the
          // factsheet is the source of truth): text-[10px] uppercase font-mono
          // tracking-wider on a surface-subtle bordered pill. ONE deliberate
          // divergence: the factsheet uses `text-text-2`, but `--color-text-2`
          // is injected only on the `.factsheet-v2-shell` palette (palette.ts);
          // this chart mounts OUTSIDE that shell, so we use the globally-declared
          // `text-text-secondary` token (the same "primary > secondary > muted"
          // mid tier text-2 maps to) — keeping `text-text-2` here would resolve
          // to an undefined var and fall back to the inherited colour.
          className="rounded-sm border border-border bg-surface-subtle px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider tabular-nums text-text-secondary hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
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
}: ScenarioFactsheetChartProps) {
  // Synthesize the minimal, valid FactsheetPayload (csv arm) the factsheet
  // TimeSeriesChart + MasterBrush consume verbatim. SINGLE full-res returns axis
  // (WR-01): `dates`/equity/drawdowns/returns/panels all derive from
  // `portfolioDaily`. Memoized so a pan (which only churns xRange in context)
  // doesn't rebuild the payload.
  const synthPayload = useMemo(
    () =>
      buildScenarioFactsheetPayload({
        benchmark: benchmark ?? null,
        portfolioDaily,
      }),
    [benchmark, portfolioDaily],
  );

  const axisLength = synthPayload.dates.length;

  return (
    // persist={false}: a scenario pan never rewrites the dashboard URL nor
    // writes a factsheet-v2: localStorage blob (T-38-03-01).
    <FactsheetProvider payload={synthPayload} persist={false}>
      {/* Q3: SegmentedControl drives the SHARED xRange via setXRange. */}
      <div className="mb-1 flex items-center justify-end">
        <PeriodControl axisLength={axisLength} />
      </div>

      {/* MasterBrush draws the scenario equity sparkline + the draggable window
          over the shared xRange — the real factsheet brush, not a lookalike. */}
      <MasterBrush />

      {/* Equity panel — scenario (accent strategy line) + benchmark (muted
          comparator), colored by resolveSeries via SCENARIO_EQUITY_CONFIG.
          The stable test hook lets Plan 05 assert overlay presence. */}
      <div data-testid="equity-chart-scenario-overlay" className="mt-4">
        <TimeSeriesChart config={SCENARIO_EQUITY_CONFIG} />
      </div>

      {/* Drawdown panel — SAME provider ⇒ shares the equity panel's xRange (Q4).
          Renders the underwater fill off the scenario's strategyDrawdowns. */}
      <div className="mt-4">
        <TimeSeriesChart config={SCENARIO_DRAWDOWN_CONFIG} />
      </div>
    </FactsheetProvider>
  );
}

export default ScenarioFactsheetChart;
