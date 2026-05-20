"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WidgetProps } from "../../lib/types";
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { CustomRangePicker } from "../../components/CustomRangePicker";
import { useTweakValue } from "../../context/TweaksContext";
import { WidgetState } from "../../components/WidgetState";
import { isWidgetStateV2Enabled } from "@/lib/widget-state-flag";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Phase 09.1 Plan 07 / D-10 — SVG EquityChart
//
// Replaces the Recharts-based EquityCurve for the V2 Overview tile.
// Designer source: designer-bundle/project/src/charts.jsx:5-245.
// Preserves the Phase 07 / VOICES-ACCEPTED f7 parallel-prop path:
// `equityDailyPoints` is the canonical data input; the f7 firstPositiveIdx
// anchor is reused verbatim so zero-leading / warm-up / stale states keep
// rendering correctly.
//
// Period toggle: 1M / 3M / 6M / YTD / 1Y / ALL / CUSTOM. Default = "6M"
// per CONTEXT §specifics. Intraday (1D / 1W) toggles are deferred per
// CONTEXT §deferred — no `EQUITY_HOURLY` handling is shipped here.
//
// Holding overlays are normalized client-side to start at 1.0 at the
// CURRENT period start so each line shows percent-from-period-start
// rather than absolute multipliers — this matches the designer's
// per-overlay tooltip arithmetic (`o.series[i] / o.series[0] - 1`).
// ---------------------------------------------------------------------------

export type Period = "1M" | "3M" | "6M" | "YTD" | "1Y" | "ALL" | "CUSTOM";

const DEFAULT_PERIOD: Period = "6M";

// All 7 period tokens, ordered for the toggle button row. Each token MUST
// appear as a quoted string in this source — the per-token grep check in
// Plan 07 acceptance criteria walks the file looking for each literal.
// Re-exported for the EquityChartWidget single-row header (PR4 #1).
export const PERIODS: readonly Period[] = [
  "1M",
  "3M",
  "6M",
  "YTD",
  "1Y",
  "ALL",
  "CUSTOM",
] as const;

export type OverlaySeries = {
  id: string;
  label: string;
  color: string;
  points: DailyPoint[];
};

export type CustomRange = { start: string; end: string };

type Props = {
  equityDailyPoints: DailyPoint[];
  benchmark?: DailyPoint[];
  overlays?: OverlaySeries[];
  stale?: boolean;
  initialPeriod?: Period;
  /**
   * Phase 10 / 10-04 D-14. Optional scenario projection — rendered as a
   * second SVG path overlay alongside the live baseline using
   * `var(--color-chart-strategy)`.
   *
   * **Caller contract (Pitfall 1 in 10-RESEARCH.md):**
   * `computeScenario().equity_curve` values are cumulative RETURN
   * (e.g. 0.18 = +18%). This chart expects cumulative WEALTH starting
   * at ~1.0. The caller (Plan 06 ScenarioComposer) MUST convert via
   * `{ date, value: point.value + 1 }` before passing here. Mismatch
   * results in the overlay starting at 0% instead of 100% — a visible
   * but silent miscompare.
   *
   * Empty array (length=0) and `null` both hide the toggle and skip
   * the overlay render. Existing call sites that don't pass this prop
   * see zero behavior change.
   */
  scenarioSeries?: DailyPoint[] | null;
  /**
   * PR4 #1 — Controlled-state escape hatch for `EquityChartWidget`'s
   * single-row card header. When `period` is supplied, the chart treats
   * the wrapper as the source of truth and forwards every period change
   * through `onPeriodChange`. When omitted, the chart runs in
   * uncontrolled mode (existing behavior — owns its own `period` state).
   */
  period?: Period;
  onPeriodChange?: (p: Period) => void;
  /** PR4 #1 — Controlled-state companion for the CUSTOM-range picker. */
  customRange?: CustomRange | null;
  onCustomRangeChange?: (r: CustomRange | null) => void;
  /**
   * PR4 #1 — When the wrapper renders the period toggle + sync stamp in
   * the card header, suppress the chart's internal copy of that row so
   * the two don't both render.
   */
  hideHeader?: boolean;
  /**
   * PR4 #1 — When the wrapper renders inline legend chips in the card
   * header, suppress the chart's internal legend strip below the header
   * row so the layout collapses to a single header line.
   */
  hideLegend?: boolean;
  /**
   * ADVERSARIAL-EQ-6 — most recent successful API key sync timestamp.
   * When `stale=true`, displayed inside the stale-dimmer overlay as
   * "Last updated 2h ago" so the allocator knows how stale the data
   * actually is. Null/undefined falls back to the previous "Data may
   * be stale" copy (so older call sites that don't yet plumb this
   * through don't regress). ISO-8601 string.
   */
  lastSyncAt?: string | null;
};

/**
 * Phase 10 / 10-04. Independent visibility state for the scenario overlay
 * vs the live baseline. Default "both" so the comparison is the
 * first-render story; switching to "live" hides the overlay (back to the
 * existing baseline-only rendering); "scenario" de-emphasizes the live
 * baseline so the projection reads as the primary line.
 */
type VisibilityMode = "live" | "scenario" | "both";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

// Exported for `EquityChartWidget` — the wrapper needs the same f7-anchored
// first-positive date for the CustomRangePicker's `min` bound (PR4 #1).
//
// pr189-followup M8 (silent-failure-hunter MED/8) — hoist the malformed-
// date breadcrumb into parseISO itself. Pre-followup, only sliceByPeriod's
// filter callback warned; the same parseISO call is reachable from the
// benchmark builder, overlay key-lookup, custom-range bounds, tick
// midpoint search, tooltip date format, and the CustomRangePicker min.
// Any of those silently dropping a date due to a malformed input would
// stay below the engineer's radar. One module-scoped dedup Set keeps the
// warning bounded (one warn per offending input string per session).
const parseISOWarnedRef = new Set<string>();
export function parseISO(s: string): number {
  // YYYY-MM-DD → epoch ms (UTC midnight). Falls back to Date constructor
  // for any non-ISO inputs so we never throw.
  const [y, m, d] = s.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
    return Date.UTC(y, m - 1, d);
  }
  const t = new Date(s).getTime();
  if (!Number.isFinite(t) && typeof console !== "undefined") {
    if (!parseISOWarnedRef.has(s)) {
      parseISOWarnedRef.add(s);
      console.warn("[EquityChart] parseISO — malformed date input", { input: s });
    }
  }
  return t;
}

/** Designer's f7 anchor — re-anchor at the first positive value.
 * Exported for `EquityChartWidget`'s picker `min` (PR4 #1). */
export function anchorFromFirstPositive(points: DailyPoint[]): DailyPoint[] {
  if (points.length === 0) return [];
  const firstPositiveIdx = points.findIndex((p) => p.value > 0);
  if (firstPositiveIdx < 0) return [];
  const anchored = points.slice(firstPositiveIdx);
  const base = anchored[0].value;
  return anchored.map((p) => ({
    date: p.date,
    value: Number((p.value / base).toFixed(6)),
  }));
}

/**
 * Slice an anchored series down to the visible window for `period`.
 * For CUSTOM, both ends are inclusive. The composite index space is
 * preserved (we filter, not re-anchor) so the f7 anchor stays stable
 * across period switches.
 */
function sliceByPeriod(
  points: DailyPoint[],
  period: Period,
  customRange: CustomRange | null,
): DailyPoint[] {
  if (points.length === 0) return [];
  const lastEpoch = parseISO(points[points.length - 1].date);
  let startEpoch: number;
  let endEpoch = lastEpoch;
  switch (period) {
    case "1M":
      startEpoch = lastEpoch - 30 * DAY_MS;
      break;
    case "3M":
      startEpoch = lastEpoch - 90 * DAY_MS;
      break;
    case "6M":
      startEpoch = lastEpoch - 180 * DAY_MS;
      break;
    case "YTD": {
      const lastDate = new Date(lastEpoch);
      startEpoch = Date.UTC(lastDate.getUTCFullYear(), 0, 1);
      break;
    }
    case "1Y":
      startEpoch = lastEpoch - 365 * DAY_MS;
      break;
    case "ALL":
      return points;
    case "CUSTOM": {
      if (!customRange) return points;
      startEpoch = parseISO(customRange.start);
      endEpoch = parseISO(customRange.end);
      // pr189-followup M1 (code-reviewer MED/8) — guard the CUSTOM
      // bounds themselves. parseISO returns NaN for truly-malformed
      // inputs; downstream `e >= NaN` / `e <= NaN` always evaluate to
      // false, so the chart silently empties without surfacing the
      // bug. parseISO already emits a per-input breadcrumb (M8), so
      // here we just fall back to ALL-period semantics to keep the
      // chart visible.
      if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) {
        if (typeof console !== "undefined") {
          console.warn(
            "[EquityChart] sliceByPeriod — malformed custom range bounds; falling back to ALL period",
            { start: customRange.start, end: customRange.end },
          );
        }
        return points;
      }
      break;
    }
  }
  return points.filter((p) => {
    const e = parseISO(p.date);
    // retro audit (silent-failure-hunter L10 c8): parseISO falls back
    // to `new Date(s).getTime()` which returns NaN on truly malformed
    // inputs ('2025-XX-01', 'invalid'). NaN comparisons (e >= start,
    // e <= end) always evaluate to false, so the bad point is silently
    // dropped. The user sees a chart that's quietly missing data. Surface
    // the failure via console.warn — kept inside the filter so the
    // breadcrumb names the offending date even if multiple are bad.
    if (!Number.isFinite(e)) {
      if (typeof console !== "undefined") {
        console.warn(
          "[EquityChart] sliceByPeriod — dropping malformed date",
          { date: p.date },
        );
      }
      return false;
    }
    return e >= startEpoch && e <= endEpoch;
  });
}

function firstDate(points: DailyPoint[]): Date {
  if (points.length === 0) return new Date();
  return new Date(parseISO(points[0].date));
}

// ---------------------------------------------------------------------------
// EquityChart — public component
// ---------------------------------------------------------------------------

export function EquityChart({
  equityDailyPoints,
  benchmark,
  overlays = [],
  stale = false,
  initialPeriod = DEFAULT_PERIOD,
  scenarioSeries = null,
  period: controlledPeriod,
  onPeriodChange,
  customRange: controlledCustomRange,
  onCustomRangeChange,
  hideHeader = false,
  hideLegend = false,
  lastSyncAt = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(960);
  // PR4 #1 — controlled-or-uncontrolled state: when the wrapper passes
  // `period` / `customRange`, those win; otherwise the chart manages its
  // own state internally (current behavior — preserves all existing
  // standalone consumers + tests).
  const [internalPeriod, setInternalPeriod] = useState<Period>(initialPeriod);
  const [internalCustomRange, setInternalCustomRange] =
    useState<CustomRange | null>(null);
  const period = controlledPeriod ?? internalPeriod;
  const customRange = controlledCustomRange ?? internalCustomRange;
  const setPeriod = (p: Period) => {
    onPeriodChange?.(p);
    if (controlledPeriod === undefined) setInternalPeriod(p);
  };
  const setCustomRange = (r: CustomRange | null) => {
    onCustomRangeChange?.(r);
    if (controlledCustomRange === undefined) setInternalCustomRange(r);
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Phase 10 / 10-04 D-14. 3-state visibility toggle for the scenario
  // overlay. Default "both" so the live-vs-scenario comparison is the
  // first-render story when the prop is supplied.
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>("both");
  const hasScenario = !!scenarioSeries && scenarioSeries.length > 0;

  // PR3 (HANDOFF G5) — Tweaks-context knobs. `chartStyle` gates the
  // gradient area fill so the prototype's Line / Area segmented control
  // flips the visual; `showBench` gates the BTC dashed overlay + legend
  // chip. Outside the provider both default to truthy values matching
  // the existing render.
  const chartStyle = useTweakValue("chartStyle");
  const showBench = useTweakValue("showBench");

  // ResizeObserver — fall back to a fixed 960 in jsdom / older runtimes.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setWidth(Math.max(400, Math.floor(cr.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Phase 07 f7 anchor — re-anchor from the first positive value. This is
  // the SAME `firstPositiveIdx` semantics consumed by EquityCurve.tsx
  // (lines 52-61); preserving it keeps zero-holdings / warm-up / stale
  // dimmer states rendering consistently across the legacy + V2 paths.
  const composite = useMemo(
    () => anchorFromFirstPositive(equityDailyPoints),
    [equityDailyPoints],
  );

  // Visible window after period filter.
  const visible = useMemo(
    () => sliceByPeriod(composite, period, customRange),
    [composite, period, customRange],
  );

  // Benchmark anchored to the SAME base as the composite (firstPositive),
  // then sliced to the visible window. We keep dates aligned by index in
  // the visible array — sliceByPeriod is index-stable on filter only.
  const visibleBenchmark = useMemo(() => {
    if (!benchmark || benchmark.length === 0) return null;
    const anchored = anchorFromFirstPositive(benchmark);
    if (anchored.length === 0) return null;
    // Build a date → value map and re-emit values aligned to the visible
    // composite dates (so a missing benchmark day for a given visible
    // composite day surfaces as `null` and is dropped by the path builder).
    const m = new Map<string, number>();
    for (const p of anchored) m.set(p.date, p.value);
    return visible.map((p) => m.get(p.date) ?? null);
  }, [benchmark, visible]);

  // Phase 10 / 10-04. Append the scenario projection as a synthetic
  // OverlaySeries so it flows through the existing normalization pipeline
  // (start-of-period anchoring at 1.0, missing-day passthrough). Caller
  // supplies WEALTH-form values starting at ~1.0 (Pitfall 1 in
  // 10-RESEARCH.md — the +1 conversion happens upstream in
  // ScenarioComposer, NOT here).
  const enrichedOverlays = useMemo(() => {
    const base = overlays ?? [];
    if (!hasScenario) return base;
    return [
      ...base,
      {
        id: "scenario",
        label: "Scenario",
        color: "var(--color-chart-strategy)",
        points: scenarioSeries!,
      },
    ];
  }, [overlays, scenarioSeries, hasScenario]);

  // Holding overlays normalized to start at 1.0 at the visible window's
  // first date. Empty / shorter overlays are silently skipped. Phase 10:
  // the scenario overlay rides through this same pipeline via
  // `enrichedOverlays` above — keeps the diff surface minimal.
  const overlaySeries = useMemo(() => {
    if (visible.length === 0) return [];
    return enrichedOverlays
      .map((o) => {
        if (!o.points || o.points.length === 0) return null;
        const m = new Map<string, number>();
        for (const p of o.points) m.set(p.date, p.value);
        // Find the base = first overlay value at or after the visible
        // window's first date.
        let baseValue: number | null = null;
        for (const v of visible) {
          const ov = m.get(v.date);
          if (ov != null && ov > 0) {
            baseValue = ov;
            break;
          }
        }
        if (baseValue == null) return null;
        const series = visible.map((v) => {
          const ov = m.get(v.date);
          if (ov == null) return null;
          return Number((ov / (baseValue as number)).toFixed(6));
        });
        return { ...o, series };
      })
      .filter((x): x is OverlaySeries & { series: Array<number | null> } =>
        x != null,
      );
  }, [enrichedOverlays, visible]);

  // Empty state — Phase 07 PURGE-04 idiom (centered helper text in the
  // chart well rather than a hard error). Mounted before any SVG so the
  // grid cell collapses cleanly when there's nothing to show.
  if (equityDailyPoints.length === 0 || composite.length === 0) {
    return (
      <div
        ref={wrapRef}
        className="flex h-[260px] w-full items-center justify-center text-sm text-text-muted"
        role="img"
        aria-label="Equity chart"
      >
        Equity data warming up
      </div>
    );
  }

  // ── Projections ────────────────────────────────────────────────────
  // pad.r carries the Y-axis tick labels on the right edge. Sized for
  // "+XX.X%" labels at 12px Geist Mono without clipping.
  const pad = { t: 20, r: 64, b: 28, l: 8 };
  const height = 260;
  const chartW = Math.max(1, width - pad.l - pad.r);
  const chartH = Math.max(1, height - pad.t - pad.b);
  const n = visible.length;

  // Period-relative normalization — re-anchor everything to 1.0 at the
  // visible window's first point. The composite is f7-anchored to the
  // first-positive value (stable across period switches), but renders a
  // line that starts at some arbitrary value like 1.15 at the 6M window
  // start. Re-anchoring here makes the axis meaningful: the line always
  // departs from 0% at the left edge and ticks read as "percent change
  // since period start" — matching the tooltip arithmetic below.
  //
  // audit-2026-05-07 M-1063 c8 — `visible[0]?.value ?? 1` only catches
  // undefined. If the first visible point's value is literally 0 (e.g. a
  // zero-equity row that slipped past the f7 anchor because the period
  // slice landed on a pre-anchor day), every division below produces
  // Infinity / NaN, the y-tick walker reads NaN bounds, and the SVG path
  // renders as a broken line off-screen with no diagnostic. Guard against
  // non-finite and non-positive bases by reusing the existing
  // "Equity data warming up" empty state below — this restores the
  // visual contract (a graceful, copy-driven fallback) ONLY on broken
  // data; the happy path is unchanged.
  const rawBasePort = visible[0]?.value ?? 1;
  if (!Number.isFinite(rawBasePort) || rawBasePort <= 0) {
    return (
      <div
        ref={wrapRef}
        className="flex h-[260px] w-full items-center justify-center text-sm text-text-muted"
        role="img"
        aria-label="Equity chart"
      >
        Equity data warming up
      </div>
    );
  }
  const basePort = rawBasePort;
  const visibleNormalized = visible.map((p) => p.value / basePort);

  // ADVERSARIAL-EQ-5 — period total return for the always-visible
  // summary chip. The chip surfaces the end-of-window return for the
  // selected period without requiring a hover, so the allocator can
  // glance at the chart and immediately see "+12.4% over 6M". Equal
  // to (last point / first point - 1), which is exactly the y-value
  // of the rightmost line endpoint after period normalization.
  const periodReturn =
    visibleNormalized.length > 0
      ? visibleNormalized[visibleNormalized.length - 1] - 1
      : 0;
  const periodReturnPositive = periodReturn >= 0;
  const periodReturnLabel = `${periodReturnPositive ? "+" : ""}${(periodReturn * 100).toFixed(2)}%`;

  const baseBench =
    visibleBenchmark
      ? visibleBenchmark.find((v): v is number => v != null) ?? null
      : null;
  const visibleBenchmarkNormalized: Array<number | null> | null =
    visibleBenchmark && baseBench != null
      ? visibleBenchmark.map((v) => (v == null ? null : v / baseBench))
      : null;

  // Y range over portfolio + benchmark + overlays (all period-relative
  // and centered on 1.0). Drop nulls AND non-finite values.
  //
  // retro audit (red-team L4 c8): the M-1063 basePort guard catches
  // NaN/<=0 portfolio bases, but overlay paths (overlaySeries) and the
  // benchmark normalisation could still produce NaN when an overlay
  // point divides 0/0 or carries a stored NaN that survived the
  // `v != null` guard (typeof NaN === 'number'). Filter at push-time
  // so a single corrupt overlay point can't poison yMin/yMax → NaN
  // ticks → broken SVG path with no diagnostic.
  const allValues: number[] = [];
  for (const v of visibleNormalized) {
    if (Number.isFinite(v)) allValues.push(v);
  }
  if (visibleBenchmarkNormalized) {
    for (const v of visibleBenchmarkNormalized) {
      if (v != null && Number.isFinite(v)) allValues.push(v);
    }
  }
  for (const o of overlaySeries) {
    for (const v of o.series) {
      if (v != null && Number.isFinite(v)) allValues.push(v);
    }
  }
  // Manual loop instead of Math.min(...allValues) — on the ALL period with
  // benchmark + ~20 overlay series the array grows to ~50k+ values, and
  // spreading into Math.min/max blows the JS call stack at ~125k args.
  let yMin = 0;
  let yMax = 1;
  if (allValues.length) {
    yMin = allValues[0];
    yMax = allValues[0];
    for (let i = 1; i < allValues.length; i++) {
      const v = allValues[i];
      if (v < yMin) yMin = v;
      else if (v > yMax) yMax = v;
    }
  }
  // Keep 1.0 (the 0% baseline) inside the plotted range so the baseline
  // reference line is always visible — without this, a strictly-up line
  // clips the 0% tick off-screen.
  yMin = Math.min(yMin, 1);
  yMax = Math.max(yMax, 1);
  // 4% visual padding so the line doesn't kiss the top or bottom edge.
  const yPadding = (yMax - yMin) * 0.04 || 0.002;
  yMin -= yPadding;
  yMax += yPadding;
  const yRange = yMax - yMin || 1;

  // Y-axis ticks — snap to "nice" percentage steps so labels don't read
  // "+1.37%". Always includes 1.0 so the 0% baseline sits on a tick.
  // PR4 #4: enforce a 5-tick minimum so narrow data ranges (test data,
  // flat-line allocators) match the truth screenshot's density. We pick
  // the LARGEST nice candidate that still yields >= MIN_TICKS — accepts a
  // sub-1% step like 0.25% on tight ranges so the strip never collapses
  // to 3 labels (+0% / -0.5% / -1.0%).
  const yTicks: number[] = (() => {
    const MIN_TICKS = 5;
    const niceMultipliers = [1, 2, 2.5, 5];
    const candidates: number[] = [];
    for (let p = -3; p <= 3; p++) {
      const pow = Math.pow(10, p);
      for (const m of niceMultipliers) candidates.push(m * pow);
    }
    candidates.sort((a, b) => a - b);
    const tickCount = (sp: number) => {
      const stepVal = sp / 100;
      const below = Math.floor((1 - yMin) / stepVal);
      const above = Math.floor((yMax - 1) / stepVal);
      return 1 + below + above;
    };
    // tickCount is monotonically decreasing in `c`. Walk ascending and
    // keep the largest candidate that still meets MIN_TICKS; bail on
    // first failure.
    //
    // audit-2026-05-07 M-1065 c8 — on degenerate ranges (yMin == yMax, or
    // tickCount(candidates[0]) already < MIN_TICKS because the padded
    // range is too small) the previous code left `stepPct` stuck at the
    // SEED value `candidates[0] = 0.001`%. The for-v loops below then
    // iterated ~80000+ ticks across the padded range, producing a
    // DOM/SVG flood with no error, no log, no fallback. Track whether
    // ANY candidate cleared MIN_TICKS; if none did, fall back to a 3-tick
    // render (yMin, 1, yMax) so the axis stays sane on flat-line
    // allocators and emit a one-shot console.warn so the case surfaces.
    let stepPct = candidates[0];
    let satisfied = false;
    for (const c of candidates) {
      if (tickCount(c) >= MIN_TICKS) {
        stepPct = c;
        satisfied = true;
      } else break;
    }
    if (!satisfied) {
      if (typeof console !== "undefined") {
        console.warn(
          "[EquityChart] y-tick walker found no candidate meeting MIN_TICKS — falling back to 3-tick render",
          { yMin, yMax, MIN_TICKS },
        );
      }
      // Fixed 3-tick render: yMin / 1.0 / yMax keeps the baseline tick
      // and bounds visible without flooding the DOM. Dedup via Set in
      // case yMin / yMax round-trip to exactly 1.0 (truly-flat series
      // post-padding); the existing render code is tolerant of either
      // 1-tick or 3-tick output here.
      //
      // retro audit (red-team L4 c8): even with the push-time isFinite
      // filter above, defence-in-depth — if the filter ever lets a
      // non-finite bound through, we DO NOT want it to reach the SVG
      // y() coordinate function (NaN → invalid SVG text attribute,
      // invisible labels with no signal). Filter the fallback set so
      // a degenerate input shape can't produce a degenerate render.
      return Array.from(
        new Set([yMin, 1, yMax].filter((v) => Number.isFinite(v))),
      ).sort((a, b) => a - b);
    }
    const stepVal = stepPct / 100;
    const ticks = new Set<number>();
    ticks.add(1);
    for (let v = 1 - stepVal; v >= yMin; v -= stepVal) ticks.add(v);
    for (let v = 1 + stepVal; v <= yMax; v += stepVal) ticks.add(v);
    // pr189-followup H3 (silent-failure-hunter HIGH/8) — the M-1065 fix
    // only fires the 3-tick fallback when `!satisfied`. For TRULY-flat
    // series where one candidate clears MIN_TICKS via yPadding=0.002,
    // the loops above can still emit 400+ ticks (stepPct=0.001%, range
    // ~0.004 → ~401 ticks). The original silent-failure surface (DOM
    // flood, no warning, no fallback) survives. Cap at 50 ticks; if
    // exceeded, emit a one-shot warn and fall back to the 3-tick safe
    // render. Belt-and-suspenders alongside the !satisfied path.
    if (ticks.size > 50) {
      if (typeof console !== "undefined") {
        console.warn(
          "[EquityChart] y-tick walker emitted >50 ticks for narrow range; capping at 3-tick fallback",
          { tickCount: ticks.size, yMin, yMax, stepPct },
        );
      }
      return Array.from(
        new Set([yMin, 1, yMax].filter((v) => Number.isFinite(v))),
      ).sort((a, b) => a - b);
    }
    return Array.from(ticks).sort((a, b) => a - b);
  })();

  const x = (i: number) =>
    n <= 1 ? pad.l + chartW / 2 : pad.l + (i / (n - 1)) * chartW;
  const y = (v: number) => pad.t + (1 - (v - yMin) / yRange) * chartH;

  const toPath = (arr: Array<number | null>) => {
    let d = "";
    let first = true;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v == null) {
        first = true;
        continue;
      }
      d += `${first ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)} `;
      first = false;
    }
    return d.trim();
  };

  const toArea = (arr: Array<number | null>) => {
    const path = toPath(arr);
    if (!path) return "";
    return `${path} L${x(n - 1).toFixed(2)},${(pad.t + chartH).toFixed(2)} L${x(0).toFixed(2)},${(pad.t + chartH).toFixed(2)} Z`;
  };

  // ── Tick density ──────────────────────────────────────────────────
  // Smart tick density: month ticks when n > 90, else 7 evenly-spaced
  // "MMM D" ticks. Mirrors designer-bundle/project/src/charts.jsx:50-87.
  type Tick = { i: number; label: string };
  const ticks: Tick[] = [];
  if (n > 90) {
    const firstEpoch = parseISO(visible[0].date);
    const lastEpoch = parseISO(visible[n - 1].date);
    const cursor = new Date(firstEpoch);
    cursor.setUTCDate(1);
    let guard = 0;
    while (cursor.getTime() <= lastEpoch && guard++ < 60) {
      const monthStart = Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        1,
      );
      const monthEnd = Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        0,
      );
      const visStart = Math.max(monthStart, firstEpoch);
      const visEnd = Math.min(monthEnd, lastEpoch);
      const visDays = (visEnd - visStart) / DAY_MS;
      if (visDays >= 7) {
        const midEpoch = (visStart + visEnd) / 2;
        // Map epoch → index by linear search (n is small in practice; this
        // is O(n*ticks) per render which is < 5k ops at ALL).
        let bestIdx = 0;
        let bestDelta = Infinity;
        for (let i = 0; i < n; i++) {
          const e = parseISO(visible[i].date);
          const dlt = Math.abs(e - midEpoch);
          if (dlt < bestDelta) {
            bestDelta = dlt;
            bestIdx = i;
          }
        }
        ticks.push({
          i: bestIdx,
          label: new Date(monthStart).toLocaleDateString("en-US", {
            month: "short",
            timeZone: "UTC",
          }),
        });
      }
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    const target = 7;
    const step = Math.max(1, Math.round(n / target));
    for (let i = n - 1; i >= 0; i -= step) {
      const d = new Date(parseISO(visible[i].date));
      ticks.push({
        i,
        label: d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      });
    }
    ticks.reverse();
  }

  // ── Hover ─────────────────────────────────────────────────────────
  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.l) / chartW) * (n - 1));
    if (i >= 0 && i < n) setHoverIdx(i);
  }

  // ── Period toggle + range picker handlers ────────────────────────
  const setPeriodChecked = (p: Period) => {
    if (p === "CUSTOM") {
      setPickerOpen(true);
      // Don't switch to CUSTOM until the user applies a range — keeps the
      // chart on the previous period if they cancel.
      return;
    }
    setPeriod(p);
    setCustomRange(null);
  };

  const applyCustom = (range: CustomRange) => {
    setCustomRange(range);
    setPeriod("CUSTOM");
    setPickerOpen(false);
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} className="relative w-full">
      {/* PR3 (dashboard parity) — single header row matching the truth
          screenshot: legend chips, period toggle, and "sync just now"
          stamp on the right. The active period button uses the subtle
          accent-10 background + accent text from the prototype, not the
          solid-fill style. The always-visible return summary is gone —
          truth shows the value via Y-axis labels + the sync timestamp,
          which is the cleaner read.
          PR4 #1 — `hideHeader` lets the wrapper move title + legend +
          period toggle + sync stamp into a single card-header row above
          the chart body. */}
      {!hideHeader && (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 6,
          flexWrap: "wrap",
        }}
      >
        <div
          role="tablist"
          aria-label="Period"
          style={{
            display: "flex",
            gap: 2,
            position: "relative",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {PERIODS.map((p) => {
            const active = period === p;
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPeriodChecked(p)}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "var(--font-mono), monospace",
                  background: active
                    ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                    : "transparent",
                  color: active
                    ? "var(--color-accent)"
                    : "var(--color-text-secondary)",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "0.04em",
                }}
              >
                {p}
              </button>
            );
          })}
          {pickerOpen && (
            <CustomRangePicker
              isOpen={pickerOpen}
              onClose={() => setPickerOpen(false)}
              onApply={applyCustom}
              min={firstDate(composite)}
              max={new Date()}
              initialRange={customRange}
            />
          )}
        </div>

        {/* Visibility toggle for the scenario overlay. Renders ONLY when
            scenarioSeries is supplied and non-empty so existing call sites
            are unaffected. Small inline pill radiogroup, monospace
            tabular-nums, accent on selected. Sits between the period
            toggle and the sync stamp so the chart header reads
            left-to-right:
              [period toggle]  [series visibility]  [sync stamp]
        */}
        {hasScenario && (
          <div
            role="radiogroup"
            aria-label="Equity series visibility"
            style={{
              display: "flex",
              gap: 2,
              alignItems: "center",
            }}
          >
            {(["live", "scenario", "both"] as const).map((m) => {
              const active = visibilityMode === m;
              const label = m === "live" ? "Live" : m === "scenario" ? "Scenario" : "Both";
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setVisibilityMode(m)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: "var(--font-mono), monospace",
                    background: active
                      ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                      : "transparent",
                    color: active
                      ? "var(--color-accent)"
                      : "var(--color-text-secondary)",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "0.04em",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* ADVERSARIAL-EQ-5 — always-visible period return summary so
              the allocator doesn't need to hover or read the y-axis to
              know "where the line ends up". Sits at the right edge of
              the header next to the sync stamp. */}
          <div
            aria-label={`Return over ${period}`}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 4,
              fontFamily: "var(--font-mono), monospace",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "var(--color-text-muted)",
              }}
            >
              {period}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: periodReturnPositive
                  ? "var(--color-positive)"
                  : "var(--color-negative)",
              }}
            >
              {periodReturnLabel}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-sans)",
            }}
            title={
              lastSyncAt
                ? new Date(lastSyncAt).toLocaleString()
                : undefined
            }
          >
            {lastSyncAt
              ? `last sync ${formatRelativeTime(lastSyncAt, Date.now())}`
              : "sync just now"}
          </div>
        </div>
      </div>
      )}

      {/* Always-visible legend strip — matches the paths rendered below.
          PR4 #1 — `hideLegend` collapses this row when the wrapper renders
          the legend chips inline in the card-header row instead. The
          swatch colors are CSS-resolved (children's elements inherit
          DOM color), so `var(--color-*)` works here. The chart-token
          hex literals are used inside the SVG below where SVG props
          do NOT resolve CSS vars. */}
      {!hideLegend && (
      <div
        aria-label="Series legend"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 6,
          fontSize: 12,
          fontFamily: "var(--font-sans)",
          color: "var(--color-text-secondary)",
          flexWrap: "wrap",
        }}
      >
        <LegendSwatch color="var(--color-chart-strategy)" label="Portfolio" />
        {showBench && visibleBenchmarkNormalized && (
          <LegendSwatch
            color="var(--color-chart-benchmark)"
            label="BTC"
            dashed
          />
        )}
        {overlaySeries.map((o) => (
          <LegendSwatch key={o.id} color={o.color} label={o.label} />
        ))}
      </div>
      )}

      <div style={{ position: "relative" }}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Equity chart"
          style={{ display: "block", cursor: "crosshair" }}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Gradient fill — uses the prefixed `--color-chart-strategy`
              token (DESIGN.md institutional teal). The bare
              `--chart-strategy` form previously here was an undefined
              CSS custom property — Tailwind v4 `@theme inline` only
              emits the prefixed `--color-*` names, so the gradient
              rendered as the SVG `currentColor` fallback. */}
          <defs>
            <linearGradient id="eq-grad" x1="0" x2="0" y1="0" y2="1">
              <stop
                offset="0%"
                stopColor="var(--color-chart-strategy)"
                stopOpacity="0.22"
              />
              <stop
                offset="100%"
                stopColor="var(--color-chart-strategy)"
                stopOpacity="0"
              />
            </linearGradient>
          </defs>

          {/* Y-axis gridlines + tick labels (right side). The 0% baseline
              is rendered stronger so the reader has a visual anchor. SVG
              `fill`/`stroke` props don't resolve CSS custom properties
              reliably, so we read the literal hex tokens from
              chart-tokens.ts (single source of truth, mirrored to
              DESIGN.md). 12px Geist Mono tabular-nums matches the
              v2-strategy chart axis-tick contract (DESIGN.md
              2026-04-29 entry — 4.85:1 on white, AA pass). */}
          {yTicks.map((v, i) => {
            const isBaseline = Math.abs(v - 1) < 1e-9;
            const yPos = y(v);
            const pct = (v - 1) * 100;
            const label = `${pct >= 0 ? "+" : ""}${pct.toFixed(pct !== 0 && Math.abs(pct) < 10 ? 1 : 0)}%`;
            return (
              <g key={i}>
                <line
                  x1={pad.l}
                  x2={width - pad.r}
                  y1={yPos}
                  y2={yPos}
                  stroke={
                    isBaseline
                      ? "var(--color-text-secondary)"
                      : "var(--color-border)"
                  }
                  strokeWidth={isBaseline ? 1.25 : 1}
                  strokeOpacity={isBaseline ? 0.85 : 0.5}
                  strokeDasharray={isBaseline ? undefined : "2 4"}
                />
                <text
                  x={width - pad.r + 4}
                  y={yPos + 3}
                  fontSize={12}
                  fill={
                    isBaseline
                      ? "var(--color-text-secondary)"
                      : "var(--color-text-muted)"
                  }
                  fontFamily="var(--font-mono), monospace"
                  textAnchor="start"
                  fontWeight={isBaseline ? 600 : 400}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* X-axis baseline + tick labels */}
          <line
            x1={pad.l}
            x2={width - pad.r}
            y1={pad.t + chartH}
            y2={pad.t + chartH}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          {ticks.map((t, i) => (
            <text
              key={i}
              x={x(t.i)}
              y={height - 10}
              fontSize={12}
              fill="var(--color-text-muted)"
              fontFamily="var(--font-sans)"
              textAnchor="middle"
            >
              {t.label}
            </text>
          ))}

          {/* Benchmark (dashed) — normalized to period start so it
              departs from the 0% baseline alongside the portfolio.
              Hidden when Tweaks → Benchmark overlay = Off. */}
          {showBench && visibleBenchmarkNormalized && (
            <path
              d={toPath(visibleBenchmarkNormalized)}
              fill="none"
              stroke="var(--color-chart-benchmark)"
              strokeWidth={1.25}
              strokeDasharray="3 3"
            />
          )}

          {/* Holding overlays (already period-normalized above). The
              scenario overlay rides through this same loop with
              id="scenario" — filter it out when the visibility toggle is
              on "live", and render it with a thicker 1.5px stroke so it
              reads as the projection peer of the live baseline. */}
          {overlaySeries
            .filter((o) =>
              o.id === "scenario" ? visibilityMode !== "live" : true,
            )
            .map((o) => {
              const isScenario = o.id === "scenario";
              return (
                <path
                  key={o.id}
                  d={toPath(o.series)}
                  fill="none"
                  stroke={o.color}
                  strokeWidth={isScenario ? 1.5 : 1.25}
                  strokeOpacity={isScenario ? 1 : 0.85}
                  data-testid={
                    isScenario ? "equity-chart-scenario-overlay" : undefined
                  }
                />
              );
            })}

          {/* Portfolio area + line. Tweaks → Equity chart = Line drops
              the gradient fill so the chart renders as a stroke-only
              line, mirroring the prototype tweak. Phase 10 / 10-04:
              when the visibility toggle is on "scenario", the live
              baseline reads as a de-emphasized reference (0.3 opacity)
              so the scenario projection takes visual priority — when
              the toggle is on "live" or "both" (default) the existing
              full-opacity rendering is preserved verbatim. */}
          {chartStyle === "area" && visibilityMode !== "scenario" && (
            <path d={toArea(visibleNormalized)} fill="url(#eq-grad)" />
          )}
          <path
            d={toPath(visibleNormalized)}
            fill="none"
            stroke="var(--color-chart-strategy)"
            strokeWidth={1.75}
            strokeOpacity={
              hasScenario && visibilityMode === "scenario" ? 0.3 : 1
            }
          />

          {/* Hover crosshair */}
          {hoverIdx != null && hoverIdx < n && (
            <g>
              <line
                x1={x(hoverIdx)}
                x2={x(hoverIdx)}
                y1={pad.t}
                y2={pad.t + chartH}
                stroke="var(--color-chart-benchmark)"
                strokeWidth={1}
                strokeDasharray="2 2"
              />
              <circle
                cx={x(hoverIdx)}
                cy={y(visibleNormalized[hoverIdx])}
                r={3.5}
                fill="var(--color-chart-strategy)"
                stroke="var(--color-surface)"
                strokeWidth={1.5}
              />
            </g>
          )}
        </svg>

        {/* Tooltip popover */}
        {hoverIdx != null && hoverIdx < n && (() => {
          const i = hoverIdx;
          const portPct = (visibleNormalized[i] - 1) * 100;
          const benchNorm =
            visibleBenchmarkNormalized && visibleBenchmarkNormalized[i] != null
              ? visibleBenchmarkNormalized[i]!
              : null;
          const benchPct = benchNorm != null ? (benchNorm - 1) * 100 : null;
          const left = Math.min(Math.max(x(i) + 10, 8), width - 220);
          return (
            <div
              style={{
                position: "absolute",
                top: 8,
                left,
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                padding: "8px 10px",
                fontSize: 12,
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                pointerEvents: "none",
                minWidth: 190,
                fontFamily: "var(--font-sans)",
              }}
            >
              <div
                style={{
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  marginBottom: 4,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {new Date(parseISO(visible[i].date)).toLocaleDateString(
                  "en-US",
                  {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  },
                )}
              </div>
              <TooltipRow
                label="Portfolio"
                color="var(--color-chart-strategy)"
                pct={portPct}
              />
              {benchPct != null && (
                <TooltipRow
                  label="BTC"
                  color="var(--color-chart-benchmark)"
                  pct={benchPct}
                  dashed
                />
              )}
              {overlaySeries.map((o) => {
                const ov = o.series[i];
                if (ov == null) return null;
                const ovPct = (ov - 1) * 100;
                return (
                  <TooltipRow
                    key={o.id}
                    label={o.label}
                    color={o.color}
                    pct={ovPct}
                  />
                );
              })}
            </div>
          );
        })()}

        {/* Stale dimmer — Phase 07 / 07-05 / D-10 visual half of the
            stale gate. Only the chart tile carries this; non-chart
            widgets are unaffected.
            ADVERSARIAL-EQ-6 — when `lastSyncAt` is supplied, the copy
            shifts from the static "Data may be stale" to a relative
            "Last updated Xh ago" so the allocator can answer "how
            stale?" without leaving the widget. */}
        {stale && (
          <div
            aria-hidden
            data-testid="equity-chart-stale"
            className="absolute inset-0 flex items-center justify-center bg-page/40 pointer-events-none"
          >
            <span className="rounded-md bg-surface px-3 py-1 text-sm font-medium text-text-secondary shadow-sm">
              {lastSyncAt
                ? `Last updated ${formatRelativeTime(lastSyncAt, Date.now())}`
                : "Data may be stale"}
            </span>
          </div>
        )}
      </div>
      {/* Intraday toggles (1D / 1W) deferred per CONTEXT §deferred */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LegendSwatch — tiny always-visible legend entry for the series above the
// chart. Separate from TooltipRow because legend rows don't carry values.
// ---------------------------------------------------------------------------
function LegendSwatch({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--color-text-secondary)",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 14,
          height: 0,
          borderTop: `${dashed ? "1.5px dashed" : "2px solid"} ${color}`,
        }}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tooltip row — small primitive, kept inline so the file stays self-contained
// ---------------------------------------------------------------------------
function TooltipRow({
  label,
  color,
  pct,
  dashed,
}: {
  label: string;
  color: string;
  pct: number;
  dashed?: boolean;
}) {
  const positive = pct >= 0;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 2,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 2,
            background: color,
            borderTop: dashed ? `1px dashed ${color}` : undefined,
          }}
        />
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono), monospace",
          fontVariantNumeric: "tabular-nums",
          color: positive
            ? "var(--color-positive)"
            : "var(--color-negative)",
          fontWeight: 500,
        }}
      >
        {positive ? "+" : ""}
        {pct.toFixed(2)}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export — WidgetProps adapter so `WIDGET_COMPONENTS["equity-chart"]`
// can lazy-import this module directly. Shape-compatible with the existing
// EquityCurve default export; reads `equityDailyPoints` from the data bag
// (Phase 07 f7 parallel-prop path). Benchmark + overlays + stale forwarded
// from the data bag too — when not present they default to undefined / false.
//
// PR4 #1 — lifts period + customRange + pickerOpen state up here so the
// card header can render `Equity curve` title, legend chips, period
// toggle, and sync stamp on a single row (mirrors the truth screenshot
// from `Allocator Dashboard - Standalone.html`). The inner `EquityChart`
// runs in controlled mode with `hideHeader` / `hideLegend` so its own
// versions of those rows collapse.
// ---------------------------------------------------------------------------

interface EquityChartWidgetData {
  equityDailyPoints?: DailyPoint[];
  btcBenchmark?: DailyPoint[];
  equityOverlays?: OverlaySeries[];
  allKeysStale?: boolean;
  /**
   * ADVERSARIAL-EQ-6 — most recent successful API key sync timestamp,
   * forwarded from the dashboard payload (`MyAllocationDashboardPayload
   * .lastSyncAt`). Surfaced in the stale-dimmer overlay copy and
   * (when non-stale) in the card-header sync stamp so the allocator
   * can answer "when did this last refresh?" without leaving the
   * widget. ISO-8601 string or null when no successful sync exists.
   */
  lastSyncAt?: string | null;
}

export default function EquityChartWidget({ data }: WidgetProps) {
  const d = (data ?? {}) as EquityChartWidgetData;
  const showBench = useTweakValue("showBench");

  // Stabilize the array reference so downstream useMemo deps (minDate,
  // periodReturn) don't churn on every render. The `?? []` literal
  // would otherwise build a new empty array each call, defeating
  // memoization and tripping react-hooks/preserve-manual-memoization.
  const equityDailyPoints = useMemo(
    () => d.equityDailyPoints ?? [],
    [d.equityDailyPoints],
  );
  const benchmark = d.btcBenchmark;
  const overlays = d.equityOverlays ?? [];
  const stale = d.allKeysStale ?? false;
  const lastSyncAt = d.lastSyncAt ?? null;
  const hasBenchmark = !!benchmark && benchmark.length > 0;

  // `now` is null on first render to keep SSR/CSR output identical. The
  // minute tick gates on label change: when the resolved relative-time
  // bucket ("2h ago") would be unchanged, return the previous value so
  // React skips the re-render. Without this gate, mounting EquityChart
  // per strategy in an aggregate-across-strategies view fires N
  // chart-subtree re-renders every minute with no visible change.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    function advance() {
      setNow((prev) => {
        const next = Date.now();
        if (!lastSyncAt || prev === null) return next;
        return formatRelativeTime(lastSyncAt, prev) ===
          formatRelativeTime(lastSyncAt, next)
          ? prev
          : next;
      });
    }
    // setTimeout(0) defers the first set out of the render commit phase
    // (satisfies react-hooks/set-state-in-effect).
    const tick = setTimeout(advance, 0);
    const interval = setInterval(advance, 60_000);
    return () => {
      clearTimeout(tick);
      clearInterval(interval);
    };
  }, [lastSyncAt]);
  const syncStampCopy = (() => {
    if (!lastSyncAt || now === null) {
      return stale ? "data stale" : "sync just now";
    }
    const rel = formatRelativeTime(lastSyncAt, now);
    return stale ? `stale · last sync ${rel}` : `last sync ${rel}`;
  })();

  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const [customRange, setCustomRange] = useState<CustomRange | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const anchored = useMemo(
    () => anchorFromFirstPositive(equityDailyPoints),
    [equityDailyPoints],
  );

  // CustomRangePicker `min` — first f7-anchored date so the picker can't
  // resolve into the leading-zero warmup window.
  const minDate = useMemo(
    () =>
      anchored.length > 0
        ? new Date(parseISO(anchored[0].date))
        : new Date(),
    [anchored],
  );

  // Period total return for the always-visible summary chip in the
  // card header. NULL when there's not enough data to draw a window
  // (the chip simply doesn't render). The `Number.isFinite(last)`
  // guard catches a corrupt trailing point that the f7 anchor's
  // `value > 0` predicate doesn't strip — without it the chip would
  // render 'NaN%' to the allocator.
  const periodReturn = useMemo<number | null>(() => {
    if (anchored.length === 0) return null;
    const window = sliceByPeriod(anchored, period, customRange);
    if (window.length === 0) return null;
    const base = window[0].value;
    const last = window[window.length - 1].value;
    if (!Number.isFinite(base) || base <= 0) return null;
    if (!Number.isFinite(last)) return null;
    return last / base - 1;
  }, [anchored, period, customRange]);

  const handlePeriodClick = (p: Period) => {
    if (p === "CUSTOM") {
      setPickerOpen(true);
      return;
    }
    setPeriod(p);
    setCustomRange(null);
  };

  const applyCustom = (range: CustomRange) => {
    setCustomRange(range);
    setPeriod("CUSTOM");
    setPickerOpen(false);
  };

  // Phase 11 / UI-BLOCK-01 — wire WidgetState v2 behind the feature flag.
  // EquityChartWidget delegates its empty branch ("Equity data warming
  // up") to the inner <EquityChart> component so the card title +
  // period toggle + sync stamp survive even when data is empty. Per
  // the UI-BLOCK-01 contract we forward the existing render through
  // <WidgetState mode="success"> when the flag is ON to prove the
  // primitive is consumed in production. The internal empty state
  // render is owned by <EquityChart> and not duplicated here.
  const v2 = isWidgetStateV2Enabled();
  const card = (
    <div
      role="region"
      aria-label="Equity curve"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.25rem",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "10px 14px 8px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 0,
          }}
        >
          <h3
            className="text-sm font-semibold uppercase tracking-wider text-text-primary"
            style={{ margin: 0 }}
          >
            Equity curve
          </h3>
          <div
            aria-label="Series legend"
            className="text-[11px] text-text-muted"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <HeaderLegendSwatch
              color="var(--color-chart-strategy)"
              label="Portfolio"
            />
            {showBench && hasBenchmark && (
              <HeaderLegendSwatch
                color="var(--color-chart-benchmark)"
                label="BTC"
                dashed
              />
            )}
            {overlays.map((o) => (
              <HeaderLegendSwatch
                key={o.id}
                color={o.color}
                label={o.label}
              />
            ))}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            role="tablist"
            aria-label="Period"
            style={{
              display: "flex",
              gap: 4,
              position: "relative",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {PERIODS.map((p) => {
              const active = period === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handlePeriodClick(p)}
                  className={
                    "cursor-pointer px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded-sm border transition-colors tabular-nums " +
                    (active
                      ? "bg-accent text-white border-accent"
                      : "bg-surface-subtle text-text-2 border-border hover:bg-surface")
                  }
                >
                  {p}
                </button>
              );
            })}
            {pickerOpen && (
              <CustomRangePicker
                isOpen={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onApply={applyCustom}
                min={minDate}
                max={new Date()}
                initialRange={customRange}
              />
            )}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* ADVERSARIAL-EQ-5 — always-visible period return summary so
              the allocator doesn't need to hover or read the y-axis to
              know "where the line ends up". Sits at the right edge of
              the card header next to the sync stamp. Hidden when the
              equity series doesn't yet have enough data to compute a
              window return (the chart itself still renders the
              warm-up placeholder). */}
          {periodReturn != null && (
            <div
              aria-label={`Return over ${period}`}
              className="flex items-baseline gap-1 font-mono tabular-nums"
            >
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted">
                {period}
              </span>
              <span
                className="text-sm font-semibold tabular-nums"
                style={{
                  color:
                    periodReturn >= 0
                      ? "var(--color-positive)"
                      : "var(--color-negative)",
                }}
              >
                {`${periodReturn >= 0 ? "+" : ""}${(periodReturn * 100).toFixed(2)}%`}
              </span>
            </div>
          )}
          <div
            className="text-[10px] font-mono uppercase tracking-[0.14em] text-text-muted"
            title={
              lastSyncAt
                ? new Date(lastSyncAt).toLocaleString()
                : undefined
            }
          >
            {syncStampCopy}
          </div>
        </div>
      </div>
      <div style={{ padding: "10px 14px 14px" }}>
        <EquityChart
          equityDailyPoints={equityDailyPoints}
          benchmark={benchmark}
          overlays={overlays}
          stale={stale}
          period={period}
          onPeriodChange={setPeriod}
          customRange={customRange}
          onCustomRangeChange={setCustomRange}
          lastSyncAt={lastSyncAt}
          hideHeader
          hideLegend
        />
      </div>
    </div>
  );

  if (v2) {
    return <WidgetState mode="success">{card}</WidgetState>;
  }
  return card;
}

function HeaderLegendSwatch({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 14,
          height: 0,
          borderTop: `${dashed ? "1.5px dashed" : "2px solid"} ${color}`,
        }}
      />
      {label}
    </span>
  );
}
