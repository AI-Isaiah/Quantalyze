"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { cn, formatPercent } from "@/lib/utils";

export type OptimizerSuggestion = {
  strategy_id: string;
  strategy_name: string;
  corr_with_portfolio: number | null;
  sharpe_lift: number | null;
  dd_improvement: number | null;
  score: number | null;
};

type ComputationStatus = "pending" | "computing" | "complete" | "failed" | null;

export interface PortfolioOptimizerProps {
  portfolioId: string;
  initialSuggestions: OptimizerSuggestion[] | null;
  computedAt: string | null;
  computationStatus: ComputationStatus;
}

const STALE_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / MS_PER_DAY);
}

function liftClass(value: number | null): string {
  if (value == null) return "text-text-muted";
  return value > 0 ? "text-positive" : "text-text-secondary";
}

function MetricCell({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-sm font-metric tabular-nums",
          liftClass(value),
        )}
      >
        {formatPercent(value)}
      </p>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  portfolioId,
}: {
  suggestion: OptimizerSuggestion;
  portfolioId: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary truncate">
          {suggestion.strategy_name}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-text-muted truncate">
          {suggestion.strategy_id}
        </p>
      </div>
      <div className="flex items-center gap-4 sm:gap-6">
        <MetricCell label="Sharpe lift" value={suggestion.sharpe_lift} />
        <MetricCell
          label="Corr reduction"
          value={suggestion.corr_with_portfolio}
        />
        <MetricCell label="DD improve" value={suggestion.dd_improvement} />
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/factsheet/${suggestion.strategy_id}`}
          className="text-xs font-medium text-accent hover:text-accent-hover underline-offset-2 hover:underline"
        >
          View strategy
        </Link>
        <Link
          href={`/portfolios/${portfolioId}/manage?add=${suggestion.strategy_id}`}
          className="inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          Add to portfolio
        </Link>
      </div>
    </div>
  );
}

function OptimizerShimmer() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-surface p-4"
        >
          <Skeleton className="h-4 w-1/3 mb-3" />
          <SkeletonText lines={2} />
        </div>
      ))}
    </div>
  );
}

export default function PortfolioOptimizer({
  portfolioId,
  initialSuggestions,
  computedAt,
  computationStatus,
}: PortfolioOptimizerProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizerSuggestion[] | null>(
    initialSuggestions,
  );
  const [lastComputedAt, setLastComputedAt] = useState<string | null>(
    computedAt,
  );

  async function runOptimizer() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio-optimizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === "failed") {
        throw new Error(data?.error ?? `Optimizer failed (${res.status})`);
      }
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      setLastComputedAt(new Date().toISOString());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Optimizer failed");
    } finally {
      setLoading(false);
    }
  }

  const heading = (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-text-primary">
        Diversification Optimizer
      </h2>
      <p className="mt-0.5 text-xs text-text-muted">
        Identify uncorrelated strategies that improve your risk-adjusted return.
      </p>
    </div>
  );

  // 2. Computing
  if (loading || computationStatus === "computing") {
    return (
      <Card>
        {heading}
        <OptimizerShimmer />
      </Card>
    );
  }

  // 5. Failed
  if (computationStatus === "failed" && !suggestions) {
    return (
      <Card>
        {heading}
        <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3">
          <p className="text-sm font-medium text-negative">
            Optimizer failed
          </p>
          <p className="mt-0.5 text-xs text-text-secondary">
            {error ?? "We couldn't compute suggestions for this portfolio."}
          </p>
        </div>
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  // 1. Empty (never run)
  if (suggestions === null) {
    return (
      <Card>
        {heading}
        <p className="text-sm text-text-secondary">
          Run the optimizer to see strategies that could improve your
          portfolio&apos;s risk-adjusted return.
        </p>
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            {loading ? "Running..." : "Run Optimizer"}
          </Button>
          {error && (
            <p className="mt-2 text-xs text-negative" role="alert">
              {error}
            </p>
          )}
        </div>
      </Card>
    );
  }

  // 3. Empty after compute
  if (suggestions.length === 0) {
    return (
      <Card>
        {heading}
        <p className="text-sm text-text-secondary">
          No candidates match your current mandate. Try relaxing filters.
        </p>
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            {loading ? "Running..." : "Re-run Optimizer"}
          </Button>
          {error && (
            <p className="mt-2 text-xs text-negative" role="alert">
              {error}
            </p>
          )}
        </div>
      </Card>
    );
  }

  // 4. + 6. Success (with optional stale banner)
  const days = daysSince(lastComputedAt);
  const isStale = days != null && days > STALE_DAYS;
  const top = suggestions.slice(0, 5);

  return (
    <Card>
      {heading}

      {isStale && (
        <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-page px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-secondary">
            Suggestions computed {days} days ago. Re-run to refresh.
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={runOptimizer}
            disabled={loading}
          >
            {loading ? "Running..." : "Re-run"}
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {top.map((s) => (
          <SuggestionRow
            key={s.strategy_id}
            suggestion={s}
            portfolioId={portfolioId}
          />
        ))}
      </div>

      {error && (
        <p className="mt-3 text-xs text-negative" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
