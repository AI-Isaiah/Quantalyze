"use client";

import { useMemo } from "react";
import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
import { PartialDataBanner } from "./PartialDataBanner";
import { MonthlyHeatmap } from "@/components/charts/MonthlyHeatmap";
import { DailyHeatmap } from "@/components/charts/DailyHeatmap";
import { ReturnHistogram } from "@/components/charts/ReturnHistogram";
import { ReturnQuantiles } from "@/components/charts/ReturnQuantiles";
import { YearlyReturns } from "@/components/charts/YearlyReturns";

interface ReturnsDistributionPanelProps {
  strategyId: string;
  history_days: number;
  monthly_returns: Record<string, Record<string, number>> | null;
  return_quantiles: Record<string, number[]> | null;
  returns_series: { date: string; value: number }[] | null;
  benchmark_returns?: { date: string; value: number }[] | null;
}

interface Panel4LazyPayload {
  daily_returns_grid?: { date: string; value: number }[];
}

/**
 * Panel 4 Returns Distribution.
 *
 * Lazy-fetches `daily_returns_grid` via `useLazyPanelMetrics<Panel4LazyPayload>("panel4")`
 * (migration 087 sibling-table contract) on first viewport intersection.
 * Mounts 5 sub-charts when status==="ready" and `history_days >= 30`:
 *
 *   1. MonthlyHeatmap (eager — `monthly_returns` from getStrategyDetailV2)
 *   2. DailyHeatmap   (lazy  — `daily_returns_grid` from sibling table; <30d sub-banner)
 *   3. ReturnHistogram (eager — `returns_series`)
 *   4. ReturnQuantiles (eager — `return_quantiles`)
 *   5. YearlyReturns  (eager — `monthly_returns`; <365d sub-banner)
 *
 * Partial-data thresholds:
 *   - Panel-level: history_days < 30 → PartialDataBanner replaces all 5 sub-charts
 *   - Sub-DailyHeatmap: empty `daily_returns_grid` → SubBanner replaces just that section
 *   - Sub-YearlyReturns: history_days < 365 → SubBanner replaces just that section
 *
 * Memoization: the `data` prop passed to the memoized DailyHeatmap is wrapped
 * with `useMemo` whose dependency is `data?.daily_returns_grid` from the
 * hook payload — NOT a fresh array literal each render. Stabilizing here
 * keeps the 5y / 1825-cell paint budget under <300ms across status
 * transitions (idle → loading → ready).
 */
export function ReturnsDistributionPanel(props: ReturnsDistributionPanelProps) {
  const { ref, data, status } = useLazyPanelMetrics<Panel4LazyPayload>("panel4", {
    fetchOnIntersect: true,
    strategyId: props.strategyId,
  });

  // Stabilize the data-prop reference passed to the memoized DailyHeatmap.
  // Without this, parent re-renders during status transitions (idle →
  // loading → ready) create fresh array references on each render — which
  // would defeat React.memo's shallow compare and re-trigger the Canvas
  // paint useEffect. The empty-array fallback lets the >0-length gate
  // below render the sub-banner cleanly.
  const dailyReturnsData = useMemo(
    () => data?.daily_returns_grid ?? [],
    [data?.daily_returns_grid],
  );

  const panelLevelGated = props.history_days < 30;

  return (
    <section
      ref={ref}
      id="panel-returns-distribution"
      tabIndex={-1}
      data-panel="returns-distribution"
      data-panel-status={status === "idle" ? "placeholder" : status}
      aria-label="Returns distribution"
      className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
    >
      <h2 className="text-base font-semibold text-text-primary">Returns distribution</h2>

      {panelLevelGated ? (
        <div className="mt-4">
          <PartialDataBanner
            heading="Awaiting more data"
            body="This strategy needs at least 30 days of trading history to populate Returns distribution."
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
        // status === 'ready'
        <div className="mt-4 space-y-6">
          <SubSection title="Monthly heatmap">
            {props.monthly_returns ? (
              <MonthlyHeatmap data={props.monthly_returns} />
            ) : (
              <SubBanner body="Monthly heatmap unavailable for this strategy." />
            )}
          </SubSection>

          <SubSection title="Daily heatmap">
            {dailyReturnsData.length > 0 ? (
              <DailyHeatmap data={dailyReturnsData} />
            ) : (
              <SubBanner body="Daily heatmap activates after 30 days of trading history." />
            )}
          </SubSection>

          <SubSection title="Return histogram">
            {props.returns_series && props.returns_series.length >= 10 ? (
              <ReturnHistogram
                returns={props.returns_series}
                benchmarkReturns={props.benchmark_returns ?? undefined}
              />
            ) : (
              <SubBanner body="Return histogram unavailable for this strategy." />
            )}
          </SubSection>

          <SubSection title="Return quantiles">
            {props.return_quantiles && Object.keys(props.return_quantiles).length > 0 ? (
              <ReturnQuantiles data={props.return_quantiles} />
            ) : (
              <SubBanner body="Return quantiles unavailable for this strategy." />
            )}
          </SubSection>

          <SubSection title="Yearly returns">
            {props.history_days >= 365 && props.monthly_returns ? (
              <YearlyReturns monthlyReturns={props.monthly_returns} />
            ) : (
              <SubBanner body="Yearly returns activates after 1 year of trading history." />
            )}
          </SubSection>
        </div>
      )}
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SubBanner({ body }: { body: string }) {
  return (
    <p className="text-xs font-normal text-text-muted">
      {body}
    </p>
  );
}
