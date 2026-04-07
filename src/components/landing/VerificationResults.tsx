"use client";

import Link from "next/link";
import { formatPercent, formatNumber, cn } from "@/lib/utils";
import { Sparkline } from "@/components/charts/Sparkline";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { Button } from "@/components/ui/Button";

interface VerificationResultsProps {
  results: {
    twr: number | null;
    sharpe: number | null;
    return_24h: number | null;
    return_mtd: number | null;
    return_ytd: number | null;
    equity_curve: { date: string; value: number }[] | null;
    trade_count: number;
  };
  matchedStrategyId: string | null;
}

function MetricCard({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-white p-4 shadow-card">
      <p className="text-xs uppercase tracking-wider text-text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-bold text-text-primary",
          mono && "font-metric",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function VerificationResults({
  results,
  matchedStrategyId,
}: VerificationResultsProps) {
  const equityValues = results.equity_curve?.map((p) => p.value) ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="TWR"
          value={formatPercent(results.twr)}
          mono
        />
        <MetricCard
          label="Sharpe"
          value={formatNumber(results.sharpe)}
          mono
        />
        <MetricCard
          label="Trade Count"
          value={results.trade_count.toLocaleString()}
          mono
        />
        <MetricCard
          label="YTD Return"
          value={formatPercent(results.return_ytd)}
          mono
        />
      </div>

      {/* Sparkline */}
      {equityValues && equityValues.length >= 2 && (
        <div className="rounded-lg border border-border bg-white p-5 shadow-card">
          <p className="mb-3 text-xs uppercase tracking-wider text-text-muted">
            Equity Curve
          </p>
          <Sparkline
            data={equityValues}
            width={560}
            height={80}
            fill
            className="w-full"
          />
        </div>
      )}

      {/* Matched strategy banner */}
      {matchedStrategyId && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-5 py-4">
          <p className="text-sm font-medium text-text-primary">
            We found your strategy on Quantalyze
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            Your verified results have been linked.{" "}
            <Link
              href={`/strategy/${matchedStrategyId}`}
              className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
            >
              View strategy page
            </Link>
          </p>
        </div>
      )}

      {/* CTAs */}
      <div className="flex flex-col items-center gap-3 pt-2 sm:flex-row sm:justify-center">
        <Link href="/signup">
          <Button size="lg">Create Account</Button>
        </Link>
        <Link href="/signup?role=manager">
          <Button variant="secondary" size="lg">
            List Your Strategy
          </Button>
        </Link>
      </div>

      <Disclaimer variant="strategy" className="text-center" />
    </div>
  );
}
