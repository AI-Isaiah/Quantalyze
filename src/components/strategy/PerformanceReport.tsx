"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { EquityCurve } from "@/components/charts/EquityCurve";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { MonthlyHeatmap } from "@/components/charts/MonthlyHeatmap";
import { MonthlyReturnsBar } from "@/components/charts/MonthlyReturnsBar";
import { ReturnQuantiles } from "@/components/charts/ReturnQuantiles";
import { RollingMetrics } from "@/components/charts/RollingMetrics";
import { ReturnHistogram } from "@/components/charts/ReturnHistogram";
import { YearlyReturns } from "@/components/charts/YearlyReturns";
import { MetricPanel } from "./MetricPanel";
import { formatPercent, formatNumber, metricColor, cn } from "@/lib/utils";
import type { StrategyAnalytics } from "@/lib/types";

const TABS = ["Overview", "Returns", "Risk"] as const;
type Tab = (typeof TABS)[number];

export function PerformanceReport({ analytics }: { analytics: StrategyAnalytics }) {
  const [tab, setTab] = useState<Tab>("Overview");

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
        <EquityCurve data={analytics.returns_series ?? []} />
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
                <h3 className="px-4 pt-3 text-sm font-semibold text-text-primary mb-2">Rolling Sharpe</h3>
                <RollingMetrics data={analytics.rolling_metrics ?? {}} />
              </Card>
            </>
          )}
        </div>

        <div className="flex-[35] min-w-0">
          <Card padding="sm">
            <MetricPanel analytics={analytics} />
          </Card>
        </div>
      </div>
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
