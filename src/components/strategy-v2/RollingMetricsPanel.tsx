"use client";

import { useState } from "react";
import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
import { SegmentedControl } from "./SegmentedControl";
import { PartialDataBanner } from "./PartialDataBanner";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { RollingVolatilityChart } from "@/components/charts/RollingVolatilityChart";
import { RollingSortinoChart } from "@/components/charts/RollingSortinoChart";
import { RollingAlphaBetaChart } from "@/components/charts/RollingAlphaBetaChart";

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
 * Per-window primary + fallback Sharpe keys (Grok B-01 — Phase 12 metrics.py
 * persists ONLY the 30d / 90d / 365d windows; the conceptual 180d window is
 * NOT shipped in v0.17.0). For each toggle, try the primary key first; fall
 * back to the documented secondary if the primary is absent. The Rolling
 * Sharpe sub-section only renders the gated sub-banner if BOTH primary and
 * fallback are absent.
 *
 * 6M maps to sharpe_90d as the closest-available approximation; downstream
 * tooltips / labels still say "6M" because UI-SPEC §3.2 locks the toggle copy.
 * The 180d window is a v0.17.1+ backend item if/when prioritized.
 */
const SHARPE_KEY_BY_WINDOW: Record<
  WindowId,
  {
    primary: "sharpe_30d" | "sharpe_90d" | "sharpe_365d";
    fallback: "sharpe_30d" | "sharpe_90d" | "sharpe_365d";
  }
> = {
  "3M": { primary: "sharpe_90d", fallback: "sharpe_30d" },
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
 * Phase 14b-03 / KPI-08..11 + KPI-23b (Panel 5) — Rolling metrics.
 *
 * Single shared 3M/6M/12M segmented-control window toggle drives 4 stacked
 * sub-charts: Rolling Sharpe (existing RollingMetrics reused with closest-
 * available persisted window key per Grok B-01), Rolling Volatility (NEW),
 * Rolling Sortino (NEW), Rolling Alpha & Beta (NEW). Per-window partial-data
 * sub-banners disable rendering of the chart body when history_days <
 * threshold for that window. Lazy-fetches Panel-5 series via the Wave-1
 * useLazyPanelMetrics hook; eager Sharpe series are passed in as props from
 * getStrategyDetailV2's analytics.rolling_metrics blob.
 *
 * NOT yet mounted in StrategyV2Shell — wiring lands in 14b-06.
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

  // WR-03: distinguish "not enough history" from "history is fine but key is absent".
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
      ) : status === "idle" || status === "loading" ? (
        <div
          aria-live="polite"
          className="mt-4 flex items-center justify-center text-xs font-normal text-text-muted"
          style={{ minHeight: 180 }}
        >
          {"Loading…"}
        </div>
      ) : status === "error" ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Couldn’t load this section"
            body="Refresh the page to retry. The other panels still work."
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

          <SubChartSection
            title="Rolling volatility"
            gated={windowGated}
            gatedBody={subBannerBody}
          >
            <RollingVolatilityChart data={volSeries} />
          </SubChartSection>

          <SubChartSection
            title="Rolling Sortino"
            gated={windowGated}
            gatedBody={subBannerBody}
          >
            <RollingSortinoChart data={sortinoSeries} />
          </SubChartSection>

          <SubChartSection
            title="Rolling alpha & beta"
            gated={false}
            gatedBody=""
          >
            <RollingAlphaBetaChart
              alpha={data?.rolling_alpha ?? []}
              beta={data?.rolling_beta ?? []}
            />
          </SubChartSection>
        </div>
      )}
    </section>
  );
}

/**
 * Grok B-01 — Pick the closest-available persisted Sharpe key for the
 * selected toggle window. Phase 12 metrics.py emits {sharpe_30d, sharpe_90d,
 * sharpe_365d} ONLY (verified at metrics.py:145-147). Returns an empty
 * object iff NONE of the 3 known keys is populated, in which case the
 * caller renders the gated sub-banner.
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

function SubChartSection({
  title,
  gated,
  gatedBody,
  children,
}: {
  title: string;
  gated: boolean;
  gatedBody: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
        {title}
      </h3>
      {gated ? (
        <p className="text-xs font-normal text-text-muted">{gatedBody}</p>
      ) : (
        children
      )}
    </div>
  );
}
