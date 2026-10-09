"use client";

import { useState } from "react";
import { useLazyPanelMetrics, type LazyStatus } from "@/hooks/useLazyPanelMetrics";
import { SegmentedControl } from "./SegmentedControl";
import { PartialDataBanner } from "./PartialDataBanner";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { RollingVolatilityChart } from "@/components/charts/RollingVolatilityChart";
import { RollingSortinoChart } from "@/components/charts/RollingSortinoChart";
import { RollingAlphaBetaChart } from "@/components/charts/RollingAlphaBetaChart";
import { rollingAlphaBetaWhy } from "@/lib/benchmark-why";
import type { AnalyticsDataQualityFlags } from "@/lib/types";

type WindowId = "3M" | "6M" | "12M";

const WINDOW_TO_DAYS: Record<WindowId, number> = {
  "3M": 90,
  "6M": 180,
  "12M": 365,
};

const WINDOW_TO_SUFFIX: Record<WindowId, "3m" | "6m" | "12m"> = {
  "3M": "3m",
  "6M": "6m",
  "12M": "12m",
};

/**
 * Per-window primary + fallback Sharpe keys. metrics.py persists ONLY the
 * 30d / 90d / 365d windows; the conceptual 180d window is NOT shipped. For
 * each toggle, try the primary key first; fall back to the documented
 * secondary if the primary is absent. The Rolling Sharpe sub-section only
 * renders the gated sub-banner if BOTH primary and fallback are absent.
 *
 * Window → primary mapping (each toggle picks the nearest persisted window):
 *   3M  → sharpe_30d  (exact-match: metrics.py:145 emits sharpe_30d directly)
 *   6M  → sharpe_90d  (closest-available — 180d not persisted)
 *   12M → sharpe_365d (exact-match)
 *
 * Without distinct primary keys, BOTH 3M and 6M would render bit-identical
 * charts. The 180d window remains a future backend item.
 */
const SHARPE_KEY_BY_WINDOW: Record<
  WindowId,
  {
    primary: "sharpe_30d" | "sharpe_90d" | "sharpe_365d";
    fallback: "sharpe_30d" | "sharpe_90d" | "sharpe_365d";
  }
> = {
  "3M": { primary: "sharpe_30d", fallback: "sharpe_90d" },
  "6M": { primary: "sharpe_90d", fallback: "sharpe_365d" },
  "12M": { primary: "sharpe_365d", fallback: "sharpe_90d" },
};

interface RollingMetricsPanelProps {
  strategyId: string;
  history_days: number;
  /** Eager Sharpe series from analytics.rolling_metrics; key is sharpe_30d/90d/365d only. */
  rolling_metrics: Record<string, { date: string; value: number }[]> | null;
  /** Eager scalar — overall (all-time) Sharpe for the avg reference line on RollingMetrics. */
  sharpe?: number | null;
  /**
   * Untrusted jsonb off strategy_analytics. Read only through
   * rollingAlphaBetaWhy, which parses native_unit before it reaches text.
   */
  data_quality_flags?: AnalyticsDataQualityFlags | null;
}

interface Panel5LazyPayload {
  rolling_sortino_3m?: { date: string; value: number }[];
  rolling_sortino_6m?: { date: string; value: number }[];
  rolling_sortino_12m?: { date: string; value: number }[];
  rolling_volatility_3m?: { date: string; value: number }[];
  rolling_volatility_6m?: { date: string; value: number }[];
  rolling_volatility_12m?: { date: string; value: number }[];
  rolling_alpha?: { date: string; value: number }[];
  rolling_beta?: { date: string; value: number }[];
}

/**
 * Rolling metrics panel.
 *
 * Single shared 3M/6M/12M segmented-control window toggle drives 4 stacked
 * sub-charts: Rolling Sharpe (RollingMetrics reused with closest-available
 * persisted window key), Rolling Volatility, Rolling Sortino, Rolling Alpha
 * & Beta. Per-window partial-data sub-banners disable rendering of the chart
 * body when history_days < threshold for that window. Lazy-fetches series
 * via useLazyPanelMetrics; eager Sharpe series are passed in as props from
 * getStrategyDetailV2's analytics.rolling_metrics blob.
 *
 * Phase 170.5 R2-02: eager content renders whatever the lazy status is. The
 * window toggle and Rolling Sharpe read props only, so they are always drawn
 * (also while loading and after a failed fetch). The lazy status gates ONLY
 * the sub-sections that read the panel5 payload (volatility, Sortino, alpha &
 * beta): "Loading…" while idle/loading inside each of them; on error the panel
 * shows ONE retry banner above them (R3-02) and they render nothing. A
 * window-gated sub-section (history shorter than the window, eager) keeps
 * saying so under any lazy status.
 */
export function RollingMetricsPanel(props: RollingMetricsPanelProps) {
  const { ref, data, status } = useLazyPanelMetrics<Panel5LazyPayload>("panel5", {
    fetchOnIntersect: true,
    strategyId: props.strategyId,
  });
  const [activeWindow, setActiveWindow] = useState<WindowId>("6M");

  const panelLevelGated = props.history_days < 90;
  const windowDays = WINDOW_TO_DAYS[activeWindow];
  const windowSuffix = WINDOW_TO_SUFFIX[activeWindow];
  const subBannerBody = `Awaiting more data — need ≥${windowDays} days for ${activeWindow} rolling window.`;
  const windowGated = props.history_days < windowDays;

  const sharpeForWindow = pickSharpeForWindow(props.rolling_metrics, activeWindow);
  const sharpeKeyAbsent = Object.keys(sharpeForWindow).length === 0;
  const sharpeGated = windowGated || sharpeKeyAbsent;

  // Distinguish "not enough history" from "history is fine but key is absent".
  // The latter occurs when analytics recompute is pending or a legacy row was never
  // backfilled — showing "need ≥N days" for a 500-day strategy is factually wrong.
  const sharpeGatedBody = windowGated
    ? subBannerBody
    : "Rolling Sharpe series not yet computed for this strategy. Check back after the next analytics run.";

  const volKey = `rolling_volatility_${windowSuffix}` as const;
  const sortinoKey = `rolling_sortino_${windowSuffix}` as const;
  const volSeries =
    (data?.[volKey as keyof Panel5LazyPayload] as
      | { date: string; value: number }[]
      | undefined) ?? [];
  const sortinoSeries =
    (data?.[sortinoKey as keyof Panel5LazyPayload] as
      | { date: string; value: number }[]
      | undefined) ?? [];

  // D-01 (Phase 170.5): the alpha/beta chart draws only with 2+ dates carrying a
  // finite alpha or beta; anything less is the say-why block, never a blank chart.
  const alphaBetaDrawable = countFinitePoints(data?.rolling_alpha, data?.rolling_beta) >= 2;

  return (
    <section
      ref={ref}
      id="panel-rolling"
      tabIndex={-1}
      data-panel="rolling"
      data-panel-status={status === "idle" ? "placeholder" : status}
      aria-label="Rolling metrics"
      className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">Rolling metrics</h2>

      {panelLevelGated ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 90 days of trading history for rolling 3M metrics."
          />
        </div>
      ) : (
        <div className="mt-4 space-y-6">
          <div className="mb-4">
            <SegmentedControl
              ariaLabel="Rolling window"
              options={[
                { id: "3M", label: "3M" },
                { id: "6M", label: "6M" },
                { id: "12M", label: "12M" },
              ]}
              activeId={activeWindow}
              onChange={(id) => setActiveWindow(id as WindowId)}
            />
          </div>

          <SubChartSection
            title="Rolling Sharpe"
            gated={sharpeGated}
            gatedBody={sharpeGatedBody}
          >
            <RollingMetrics
              data={sharpeForWindow}
              overallSharpe={props.sharpe ?? null}
            />
          </SubChartSection>

          {status === "error" ? (
            // R3-02: ONE notice for the one failed panel5 fetch, at the start of
            // the lazy sub-sections. They render nothing on error (a window-gated
            // one still states its eager gate), so a single failure is not drawn
            // as three.
            <PartialDataBanner
              heading="Couldn’t load this section"
              body="Refresh the page to retry. The other panels still work."
            />
          ) : null}

          <SubChartSection
            title="Rolling volatility"
            gated={windowGated}
            gatedBody={subBannerBody}
            lazyStatus={status}
          >
            <RollingVolatilityChart data={volSeries} />
          </SubChartSection>

          <SubChartSection
            title="Rolling Sortino"
            gated={windowGated}
            gatedBody={subBannerBody}
            lazyStatus={status}
          >
            <RollingSortinoChart data={sortinoSeries} />
          </SubChartSection>

          <SubChartSection
            title="Rolling alpha & beta"
            caption={ALPHA_BETA_CAPTION}
            lazyStatus={status}
          >
            {alphaBetaDrawable ? (
              <RollingAlphaBetaChart
                alpha={data?.rolling_alpha ?? []}
                beta={data?.rolling_beta ?? []}
              />
            ) : (
              // minHeight 250 = RollingAlphaBetaChart's ResponsiveContainer
              // height, so toggling never shifts the page. Same text at every
              // window: the series is window-independent (90 paired intervals).
              <div
                className="flex items-center"
                style={{ minHeight: 250 }}
                data-testid="rolling-alpha-beta-why"
              >
                <p className="text-xs font-normal text-text-muted">
                  {rollingAlphaBetaWhy({
                    flags: props.data_quality_flags,
                    historyDays: props.history_days,
                  })}
                </p>
              </div>
            )}
          </SubChartSection>
        </div>
      )}
    </section>
  );
}

/**
 * Pick the closest-available persisted Sharpe key for the selected toggle
 * window. metrics.py emits {sharpe_30d, sharpe_90d, sharpe_365d} ONLY
 * (verified at metrics.py:145-147). Returns an empty object iff NONE of the
 * 3 known keys is populated, in which case the caller renders the gated
 * sub-banner.
 *
 * The returned shape is `{ sharpe_30d|sharpe_90d|sharpe_365d: series }` so
 * downstream <RollingMetrics> resolves the line stroke via STROKE_BY_KEY.
 * Never use a non-persisted key (e.g. a bare "sharpe" or a phantom 180d
 * variant) — STROKE_BY_KEY would default to CHART_TEXT_MUTED instead of
 * CHART_ACCENT.
 */
function pickSharpeForWindow(
  rolling: Record<string, { date: string; value: number }[]> | null,
  win: WindowId,
): Record<string, { date: string; value: number }[]> {
  if (!rolling) return {};
  const { primary, fallback } = SHARPE_KEY_BY_WINDOW[win];
  const primarySeries = rolling[primary];
  if (Array.isArray(primarySeries) && primarySeries.length > 0) {
    return { [primary]: primarySeries };
  }
  const fallbackSeries = rolling[fallback];
  if (Array.isArray(fallbackSeries) && fallbackSeries.length > 0) {
    return { [fallback]: fallbackSeries };
  }
  return {};
}

const ALPHA_BETA_CAPTION =
  "90-day rolling window, paired with BTC. The 3M / 6M / 12M toggle sets the charts above, not this one.";

/**
 * Dates that carry a finite alpha or a finite beta, merged across both series.
 * The lazy payload is untrusted jsonb: a non-string date or a non-finite value
 * never counts, so it can never make a chart draw.
 */
function countFinitePoints(
  alpha: { date: string; value: number }[] | undefined,
  beta: { date: string; value: number }[] | undefined,
): number {
  const dates = new Set<string>();
  for (const series of [alpha, beta]) {
    if (!Array.isArray(series)) continue;
    for (const p of series) {
      if (typeof p?.date === "string" && Number.isFinite(p.value)) dates.add(p.date);
    }
  }
  return dates.size;
}

function SubChartSection({
  title,
  gated = false,
  gatedBody = "",
  caption,
  lazyStatus,
  children,
}: {
  title: string;
  /** Omitted for a section that never swaps its body for a banner line (alpha & beta says why itself). */
  gated?: boolean;
  gatedBody?: string;
  caption?: string;
  /**
   * Passed ONLY by a sub-section that reads the lazy panel5 payload. Omitted
   * by an eager one (Rolling Sharpe), which then renders whatever the lazy
   * status is (R2-02). Eager `gated` wins over it: a window the history does
   * not cover is not a fetch problem.
   */
  lazyStatus?: LazyStatus;
  children: React.ReactNode;
}) {
  // A failed lazy fetch is announced once by the panel (R3-02), not per
  // sub-section. An eager window gate still renders: it is not a fetch problem.
  if (!gated && lazyStatus === "error") return null;
  return (
    <div>
      <h3
        className={`${caption ? "mb-1" : "mb-4"} text-xs font-normal uppercase tracking-wider text-text-secondary`}
      >
        {title}
      </h3>
      {caption ? (
        <p className="mb-4 text-xs font-normal text-text-muted">{caption}</p>
      ) : null}
      {gated ? (
        <p className="text-xs font-normal text-text-muted">{gatedBody}</p>
      ) : lazyStatus === "idle" || lazyStatus === "loading" ? (
        <div
          aria-live="polite"
          className="flex items-center justify-center text-xs font-normal text-text-muted"
          style={{ minHeight: 180 }}
        >
          {"Loading…"}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
