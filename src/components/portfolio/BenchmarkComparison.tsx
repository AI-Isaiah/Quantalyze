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
    note?: string;
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
        <h3 className="font-display text-body text-text-primary mb-2">
          Benchmark Comparison
        </h3>
        <p className="text-small text-text-muted">Benchmark data unavailable.</p>
      </Card>
    );
  }

  const { symbol, correlation, benchmark_twr, portfolio_twr, stale, note } =
    benchmarkComparison;
  const alpha =
    portfolio_twr != null && benchmark_twr != null
      ? portfolio_twr - benchmark_twr
      : null;

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-body text-text-primary">
          vs {symbol}
        </h3>
        {stale && (
          <span className="text-micro uppercase tracking-wider text-text-muted bg-page px-2 py-0.5 rounded">
            Stale
          </span>
        )}
      </div>

      {/* Phase 166.4.1 D-04 / D-05: the stored reason the BTC figures are empty,
          rendered verbatim as a text node. Amber (recoverable) only when the
          stored `stale` is true; otherwise muted. Never red: absence is not
          a failure (DESIGN.md Color). */}
      {note ? (
        <p
          role="status"
          aria-live="polite"
          className={`mb-4 text-small break-words first-letter:uppercase ${
            stale
              ? "text-warning bg-warning-bg border border-warning-border rounded px-2 py-1"
              : "text-text-muted"
          }`}
        >
          {note}
        </p>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="text-center">
          <p className="text-micro uppercase tracking-wider text-text-muted font-medium">
            Portfolio TWR
          </p>
          <p className={`mt-1 text-h3 font-bold font-metric ${metricColor(portfolio_twr)}`}>
            {formatPercent(portfolio_twr)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-micro uppercase tracking-wider text-text-muted font-medium">
            {symbol} TWR
          </p>
          <p className={`mt-1 text-h3 font-bold font-metric ${metricColor(benchmark_twr)}`}>
            {formatPercent(benchmark_twr)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-micro uppercase tracking-wider text-text-muted font-medium">
            Alpha
          </p>
          <p className={`mt-1 text-h3 font-bold font-metric ${metricColor(alpha)}`}>
            {formatPercent(alpha)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-micro uppercase tracking-wider text-text-muted font-medium">
            Correlation
          </p>
          <p className="mt-1 text-h3 font-bold font-metric text-text-primary">
            {formatNumber(correlation)}
          </p>
        </div>
      </div>
    </Card>
  );
}
