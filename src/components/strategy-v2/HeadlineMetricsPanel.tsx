"use client";

import { useState } from "react";
import type { StrategyV2Detail } from "@/lib/queries";
import { EquityCurve } from "@/components/charts/EquityCurve";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { fetchStrategyLazyMetricsClient } from "@/lib/queries-client";
import { SegmentedControl } from "./SegmentedControl";
import { PartialDataBanner } from "./PartialDataBanner";

interface HeadlineMetricsPanelProps {
  /** Strategy id used by the Log returns lazy fetch (panel 2 is eager-mounted; no observer). */
  strategyId: string;
  panel2Headline: StrategyV2Detail["panel2Headline"];
  panel2Equity: StrategyV2Detail["panel2Equity"];
  /**
   * Eager rolling-Sharpe series from analytics.rolling_metrics. Fed by
   * `panel5Inputs.rolling_metrics`. Reused here so Panel 2's "Rolling
   * Sharpe" toggle can render immediately without its own lazy fetch —
   * metrics.py persists rolling Sharpe in strategy_analytics.rolling_metrics,
   * NOT migration 087's sibling table.
   */
  rolling_metrics: Record<string, { date: string; value: number }[]> | null;
  history_days: number;
}

const EM_DASH = "—";

function fmtPct(value: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return `${(value * 100).toFixed(2)}%`;
}

function fmtRatio(value: number | null): string {
  if (value === null || value === undefined) return EM_DASH;
  return value.toFixed(2);
}

function signColor(value: number | null): string {
  if (value === null || value === undefined) return "text-text-primary";
  if (value > 0) return "text-positive";
  if (value < 0) return "text-negative";
  return "text-text-primary";
}

type ActiveView = "cumulative" | "underwater" | "rolling_sharpe" | "log_returns";

/**
 * Panel 2 Headline metrics + Equity vs BTC.
 *
 * Client component (owns segmented-control state + BTC checkbox state +
 * Log returns lazy-fetch state). Renders:
 *   1. KPI strip (Cum return / CAGR / Sharpe / Sortino / Max DD / Vol) with
 *      sign-coloring on Cum return + CAGR; Max DD always negative-colored
 *   2. Segmented control: 4 buttons all enabled — Cumulative (default) /
 *      Underwater / Rolling Sharpe / Log returns
 *   3. BTC overlay checkbox (default-ON; hidden when overlay data is null
 *      AND only relevant in Cumulative / Underwater views)
 *   4. EquityCurve OR DrawdownChart OR RollingMetrics based on active view
 *
 * Partial-data banners gate on:
 *   - history_days < 30 → KPI strip replaced by banner
 *   - history_days < 7  → chart body replaced by banner
 *
 * Sub-views:
 *   - Rolling Sharpe view: renders <RollingMetrics> against the eager
 *     `rolling_metrics` prop (analytics.rolling_metrics) with the overall
 *     Sharpe scalar as the dashed reference line. No lazy fetch needed —
 *     metrics.py persists rolling Sharpe in strategy_analytics.
 *   - Log returns view: lazily fires `fetchStrategyLazyMetricsClient(
 *     strategyId, "equity")` on first activation (migration 087 maps
 *     'equity' → ARRAY['log_returns_series'] — see
 *     supabase/migrations/20260428120919_strategy_analytics_series.sql:165). Result
 *     is cached in component state; subsequent toggles do NOT re-fetch.
 *     Empty payload / error path renders the standard PartialDataBanner.
 *
 * NOTE: We use `fetchStrategyLazyMetricsClient` (the client-safe mirror at
 * src/lib/queries-client.ts) NOT the server-only `fetchStrategyLazyMetrics`
 * from src/lib/queries.ts — the latter transitively imports `next/headers`
 * via @/lib/supabase/admin and Turbopack rejects it inside any "use client"
 * module graph.
 */
export function HeadlineMetricsPanel({
  strategyId,
  panel2Headline,
  panel2Equity,
  rolling_metrics,
  history_days,
}: HeadlineMetricsPanelProps) {
  const [activeView, setActiveView] = useState<ActiveView>("cumulative");
  const [showBenchmark, setShowBenchmark] = useState<boolean>(true); // default-ON

  // Log returns lazy state. The fetch fires once on first activation of the
  // Log returns view (triggered from the segmented-control click handler —
  // event-driven, NOT inside an effect). Subsequent toggles read from the
  // cached `logReturns` state (no re-fetch).
  // Lifecycle:
  //   idle    → user has not yet activated Log returns (no fetch)
  //   loading → fetch in flight; show centered "Loading…"
  //   ready   → payload resolved; render EquityCurve OR PartialDataBanner
  //             (when log_returns_series is empty)
  //   error   → fetch threw; render PartialDataBanner; do not retry
  const [logReturns, setLogReturns] = useState<
    { date: string; value: number }[] | null
  >(null);
  const [logReturnsStatus, setLogReturnsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");

  // panelId "equity" maps via migration 087 (line 165) to
  // ARRAY['log_returns_series']. The RPC returns
  // { log_returns_series: [{date, value}, ...] } on success or {} on
  // visibility-gate / empty payload. Defensive null-check below renders
  // the partial-data banner if the payload is empty.
  function handleViewChange(nextView: ActiveView) {
    setActiveView(nextView);
    // Lazy-fetch the log-returns series exactly once, on first activation
    // of the Log returns view. Cached on subsequent toggles via the
    // `logReturnsStatus !== "idle"` guard.
    if (nextView !== "log_returns") return;
    if (logReturnsStatus !== "idle") return;
    setLogReturnsStatus("loading");
    fetchStrategyLazyMetricsClient(strategyId, "equity")
      .then((payload) => {
        const series =
          (payload as {
            log_returns_series?: { date: string; value: number }[];
          }).log_returns_series ?? [];
        setLogReturns(series);
        setLogReturnsStatus("ready");
      })
      .catch((err: unknown) => {
        console.error("HeadlineMetricsPanel log_returns fetch failed", {
          strategyId,
          err,
        });
        setLogReturnsStatus("error");
      });
  }

  const showKpiBanner = history_days < 30;
  const showChartBanner = history_days < 7 || !panel2Equity.series;
  const benchmarkAvailable = panel2Equity.btc_overlay !== null;

  const segOptions = [
    { id: "cumulative", label: "Cumulative" },
    { id: "underwater", label: "Underwater" },
    { id: "rolling_sharpe", label: "Rolling Sharpe" },
    { id: "log_returns", label: "Log returns" },
  ];

  // Effective benchmark: pass null when checkbox is off, regardless of
  // whether overlay data exists. The chart components treat null as "no
  // benchmark" and will not render the BTC line.
  const effectiveBenchmark =
    showBenchmark && benchmarkAvailable ? panel2Equity.btc_overlay : null;

  return (
    <section
      id="panel-headline-equity"
      tabIndex={-1}
      data-panel="headline-equity"
      aria-label="Headline metrics & equity vs BTC"
      className="mt-8 rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">Headline metrics</h2>

      {showKpiBanner ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 30 days of trading history for stable Sharpe and Sortino estimates."
          />
        </div>
      ) : (
        <dl className="mt-4 grid grid-cols-6 gap-3 max-md:grid-cols-3">
          <div>
            <dt className="text-xs font-normal text-text-muted">Cum return</dt>
            <dd
              className={`mt-1 text-lg font-semibold tabular-nums ${signColor(
                panel2Headline.cumulative_return,
              )}`}
            >
              {fmtPct(panel2Headline.cumulative_return)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">CAGR</dt>
            <dd
              className={`mt-1 text-lg font-semibold tabular-nums ${signColor(
                panel2Headline.cagr,
              )}`}
            >
              {fmtPct(panel2Headline.cagr)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Sharpe</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtRatio(panel2Headline.sharpe)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Sortino</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtRatio(panel2Headline.sortino)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Max DD</dt>
            <dd className="mt-1 text-lg font-semibold text-negative tabular-nums">
              {fmtPct(panel2Headline.max_drawdown)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-normal text-text-muted">Vol</dt>
            <dd className="mt-1 text-lg font-semibold text-text-primary tabular-nums">
              {fmtPct(panel2Headline.volatility)}
            </dd>
          </div>
        </dl>
      )}

      <hr className="my-4 border-t border-border" />

      <h3 className="text-xs font-normal uppercase tracking-wider text-text-secondary">
        Equity vs BTC
      </h3>

      <div className="mt-4 flex items-center justify-between">
        <SegmentedControl
          options={segOptions}
          activeId={activeView}
          onChange={(id) => handleViewChange(id as ActiveView)}
          ariaLabel="Equity chart view"
        />

        {benchmarkAvailable &&
        (activeView === "cumulative" || activeView === "underwater") ? (
          <label className="flex items-center gap-2 text-xs font-normal text-text-secondary">
            <input
              type="checkbox"
              checked={showBenchmark}
              onChange={(e) => setShowBenchmark(e.target.checked)}
            />
            BTC benchmark
          </label>
        ) : null}
      </div>

      <div className="mt-4">
        {showChartBanner &&
        (activeView === "cumulative" || activeView === "underwater") ? (
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 7 days of equity history."
          />
        ) : activeView === "cumulative" ? (
          <EquityCurve
            data={panel2Equity.series ?? []}
            benchmarkSeries={effectiveBenchmark}
            hideBenchmarkToggle
          />
        ) : activeView === "underwater" ? (
          <DrawdownChart
            data={
              // Underwater view derives drawdown from the equity series:
              // value/maxSoFar - 1. The dedicated underwater payload is
              // sourced upstream when available; otherwise this local
              // transformation produces a usable drawdown view from the
              // cumulative-return baseline. DrawdownChart consumes any
              // time-series with negative values.
              (panel2Equity.series ?? []).map((d, i, arr) => {
                const runningMax = arr.slice(0, i + 1).reduce(
                  (mx, p) => Math.max(mx, p.value),
                  arr[0]?.value ?? 1,
                );
                return { date: d.date, value: d.value / runningMax - 1 };
              })
            }
            benchmarkSeries={effectiveBenchmark}
          />
        ) : activeView === "rolling_sharpe" ? (
          rolling_metrics && Object.keys(rolling_metrics).length > 0 ? (
            <RollingMetrics
              data={rolling_metrics}
              overallSharpe={panel2Headline.sharpe ?? null}
            />
          ) : (
            <PartialDataBanner
              heading="Awaiting more data"
              body="Rolling Sharpe series not yet computed for this strategy."
            />
          )
        ) : activeView === "log_returns" ? (
          logReturnsStatus === "loading" || logReturnsStatus === "idle" ? (
            <div
              aria-live="polite"
              className="flex items-center justify-center text-xs font-normal text-text-muted"
              style={{ minHeight: 240 }}
            >
              {"Loading…"}
            </div>
          ) : logReturnsStatus === "error" ||
            !logReturns ||
            logReturns.length === 0 ? (
            <PartialDataBanner
              heading="Awaiting more data"
              body="Log returns series unavailable for this strategy."
            />
          ) : (
            <EquityCurve
              data={logReturns}
              benchmarkSeries={null}
              hideBenchmarkToggle
            />
          )
        ) : null}
      </div>
    </section>
  );
}
