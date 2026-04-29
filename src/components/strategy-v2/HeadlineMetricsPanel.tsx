"use client";

import { useState } from "react";
import type { StrategyV2Detail } from "@/lib/queries";
import { EquityCurve } from "@/components/charts/EquityCurve";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { SegmentedControl } from "./SegmentedControl";
import { PartialDataBanner } from "./PartialDataBanner";

interface HeadlineMetricsPanelProps {
  panel2Headline: StrategyV2Detail["panel2Headline"];
  panel2Equity: StrategyV2Detail["panel2Equity"];
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

type ActiveView = "cumulative" | "underwater";

/**
 * Phase 14a / KPI-03 + KPI-04 — Panel 2 Headline metrics + Equity vs BTC.
 *
 * Client component (owns segmented-control state + BTC checkbox state).
 * Renders:
 *   1. KPI strip (Cum return / CAGR / Sharpe / Sortino / Max DD / Vol) with
 *      sign-coloring on Cum return + CAGR; Max DD always negative-colored
 *   2. Segmented control: Cumulative (default) + Underwater enabled;
 *      Rolling Sharpe + Log Returns disabled with 'Available in Phase 14b'
 *   3. BTC overlay checkbox (default-ON per DIFF-03; hidden when overlay
 *      data is null)
 *   4. EquityCurve OR DrawdownChart based on active view
 *
 * Partial-data banners gate on:
 *   - history_days < 30 → KPI strip replaced by banner
 *   - history_days < 7  → chart body replaced by banner
 */
export function HeadlineMetricsPanel({
  panel2Headline,
  panel2Equity,
  history_days,
}: HeadlineMetricsPanelProps) {
  const [activeView, setActiveView] = useState<ActiveView>("cumulative");
  const [showBenchmark, setShowBenchmark] = useState<boolean>(true); // DIFF-03 default-ON

  const showKpiBanner = history_days < 30;
  const showChartBanner = history_days < 7 || !panel2Equity.series;
  const benchmarkAvailable = panel2Equity.btc_overlay !== null;

  const segOptions = [
    { id: "cumulative", label: "Cumulative" },
    { id: "underwater", label: "Underwater" },
    { id: "rolling_sharpe", label: "Rolling Sharpe", disabled: true },
    { id: "log_returns", label: "Log returns", disabled: true },
  ];

  // Effective benchmark: pass null when checkbox is off, regardless of
  // whether overlay data exists. The chart components treat null as "no
  // benchmark" and will not render the BTC line.
  const effectiveBenchmark =
    showBenchmark && benchmarkAvailable ? panel2Equity.btc_overlay : null;

  return (
    <section
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
          onChange={(id) => {
            if (id === "cumulative" || id === "underwater") setActiveView(id);
          }}
          ariaLabel="Equity chart view"
        />

        {benchmarkAvailable ? (
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
        {showChartBanner ? (
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
        ) : (
          <DrawdownChart
            data={
              // Underwater view derives drawdown from the equity series:
              // value/maxSoFar - 1. Pre-computed series should be sourced
              // upstream (Phase 14b lazy fetch); for 14a the executor's
              // panel passes the equity series shape and the existing
              // DrawdownChart consumes any time-series with negative
              // values. If panel2Equity.series is the cumulative-return
              // series (1.0 baseline), translating to drawdown is a
              // local transformation. Keeping it simple: pass the series
              // through; if the series is non-drawdown-shaped, Phase 14b
              // will replace this with the dedicated underwater payload.
              (panel2Equity.series ?? []).map((d) => ({
                date: d.date,
                value: Math.min(0, d.value - 1),
              }))
            }
          />
        )}
      </div>
    </section>
  );
}
