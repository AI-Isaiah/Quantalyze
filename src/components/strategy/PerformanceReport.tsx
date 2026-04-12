"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { EquityCurve } from "@/components/charts/EquityCurve";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { MonthlyHeatmap } from "@/components/charts/MonthlyHeatmap";
import { MonthlyReturnsBar } from "@/components/charts/MonthlyReturnsBar";
import { ReturnQuantiles } from "@/components/charts/ReturnQuantiles";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { ReturnHistogram } from "@/components/charts/ReturnHistogram";
import { RiskOfRuin } from "@/components/charts/RiskOfRuin";
import { YearlyReturns } from "@/components/charts/YearlyReturns";
import { WorstDrawdowns } from "@/components/charts/WorstDrawdowns";
import { CorrelationWithBenchmark } from "@/components/charts/CorrelationWithBenchmark";
import { MetricPanel } from "./MetricPanel";
import type { Percentiles } from "./MetricPanel";
import { VolumeExposureTab } from "./VolumeExposureTab";
import { PositionsTab } from "./PositionsTab";
import { formatPercent, formatNumber, metricColor, cn } from "@/lib/utils";
import type { StrategyAnalytics, Position } from "@/lib/types";

const TABS = ["Overview", "Returns", "Risk", "Volume & Exposure", "Positions"] as const;
type Tab = (typeof TABS)[number];

export function PerformanceReport({ analytics, percentiles, positions }: { analytics: StrategyAnalytics; percentiles?: Percentiles; positions?: Position[] | null }) {
  const [tab, setTab] = useState<Tab>("Overview");

  const benchmarkSeries = useMemo(() => {
    const raw = analytics.metrics_json?.benchmark_returns;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw as { date: string; value: number }[];
  }, [analytics.metrics_json]);

  const riskOfRuinData = useMemo(() => {
    const raw = analytics.metrics_json?.risk_of_ruin;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw as { loss_pct: number; probability: number }[];
  }, [analytics.metrics_json]);

  return (
    <div>
      {/* Hero: headline metrics */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <HeroMetric label="CAGR" value={formatPercent(analytics.cagr)} colorClass={metricColor(analytics.cagr)} />
        <HeroMetric label="Sharpe" value={formatNumber(analytics.sharpe)} colorClass={metricColor(analytics.sharpe)} />
        <HeroMetric label="Max Drawdown" value={formatPercent(analytics.max_drawdown)} colorClass="text-negative" />
      </div>

      {/* Hero: equity curve */}
      <Card className="mb-6" padding="sm">
        <EquityCurve data={analytics.returns_series ?? []} benchmarkSeries={benchmarkSeries} />
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Two-column: charts (65%) + metrics (35%) */}
      <div className="flex gap-6">
        <div className="flex-[65] min-w-0 space-y-6">
          {tab === "Overview" && (
            <>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Underwater / Drawdown</h3>
                <DrawdownChart data={analytics.drawdown_series ?? []} />
              </Card>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Worst Drawdowns</h3>
                <WorstDrawdowns analytics={analytics} />
              </Card>
            </>
          )}
          {tab === "Returns" && (
            <>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Monthly Returns</h3>
                <MonthlyHeatmap data={analytics.monthly_returns ?? {}} />
              </Card>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Monthly Returns Bar</h3>
                <MonthlyReturnsBar data={analytics.monthly_returns ?? {}} />
              </Card>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Return Quantiles</h3>
                <ReturnQuantiles data={analytics.return_quantiles ?? {}} />
              </Card>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Yearly Returns</h3>
                <YearlyReturns monthlyReturns={analytics.monthly_returns ?? {}} />
              </Card>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Return Distribution</h3>
                <ReturnHistogram returns={analytics.returns_series ?? []} />
              </Card>
            </>
          )}
          {tab === "Risk" && (
            <>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Correlation with BTC</h3>
                <CorrelationWithBenchmark analytics={analytics} />
              </Card>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Rolling Sharpe</h3>
                <RollingMetrics data={analytics.rolling_metrics ?? {}} overallSharpe={analytics.sharpe} />
              </Card>
              <Card padding="sm">
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Risk of Ruin</h3>
                <RiskOfRuin data={riskOfRuinData} />
              </Card>
            </>
          )}
        </div>

        {(tab === "Overview" || tab === "Returns" || tab === "Risk") && (
          <div className="flex-[35] min-w-0">
            <Card padding="sm">
              <MetricPanel analytics={analytics} percentiles={percentiles} />
            </Card>
          </div>
        )}
      </div>

      {/* Full-width tabs with their own layout */}
      {tab === "Volume & Exposure" && (
        <VolumeExposureTab analytics={analytics} />
      )}
      {tab === "Positions" && (
        <PositionsTab analytics={analytics} positions={positions ?? null} />
      )}
    </div>
  );
}

function HeroMetric({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <Card padding="sm" className="text-center">
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">{label}</p>
      <p className={cn("mt-1 text-[28px] font-bold font-metric", colorClass ?? "text-text-primary")}>
        {value}
      </p>
    </Card>
  );
}
