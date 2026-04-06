"use client";

import { Card } from "@/components/ui/Card";
import { formatPercent, formatNumber } from "@/lib/utils";

interface BenchmarkComparisonProps {
  benchmarkComparison: {
    symbol: string;
    correlation: number | null;
    benchmark_twr: number | null;
    portfolio_twr: number | null;
    stale: boolean;
  } | null;
}

function metricColor(value: number | null | undefined): string {
  if (value == null) return "text-text-muted";
  return value >= 0 ? "text-positive" : "text-negative";
}

export function BenchmarkComparison({ benchmarkComparison }: BenchmarkComparisonProps) {
  if (!benchmarkComparison) {
    return (
      <Card padding="md">
        <h3 className="font-display text-lg text-text-primary mb-2">
          Benchmark Comparison
        </h3>
        <p className="text-sm text-text-muted">Benchmark data unavailable.</p>
      </Card>
    );
  }

  const { symbol, correlation, benchmark_twr, portfolio_twr, stale } = benchmarkComparison;
  const alpha =
    portfolio_twr != null && benchmark_twr != null
      ? portfolio_twr - benchmark_twr
      : null;

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg text-text-primary">
          vs {symbol}
        </h3>
        {stale && (
          <span className="text-[10px] uppercase tracking-wider text-text-muted bg-page px-2 py-0.5 rounded">
            Stale
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Portfolio TWR
          </p>
          <p className={`mt-1 text-xl font-bold font-metric ${metricColor(portfolio_twr)}`}>
            {formatPercent(portfolio_twr)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            {symbol} TWR
          </p>
          <p className={`mt-1 text-xl font-bold font-metric ${metricColor(benchmark_twr)}`}>
            {formatPercent(benchmark_twr)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Alpha
          </p>
          <p className={`mt-1 text-xl font-bold font-metric ${metricColor(alpha)}`}>
            {formatPercent(alpha)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
            Correlation
          </p>
          <p className="mt-1 text-xl font-bold font-metric text-text-primary">
            {formatNumber(correlation)}
          </p>
        </div>
      </div>
    </Card>
  );
}
