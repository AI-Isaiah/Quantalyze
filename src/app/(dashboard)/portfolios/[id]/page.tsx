import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { PortfolioKPIRow } from "@/components/portfolio/PortfolioKPIRow";
import { StrategyBreakdownTable } from "@/components/portfolio/StrategyBreakdownTable";
import { AlertsList } from "@/components/portfolio/AlertsList";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { FreshnessBadge } from "@/components/strategy/FreshnessBadge";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import {
  getPortfolioDetail,
  getPortfolioStrategies,
  getPortfolioAnalytics,
  getPortfolioAlerts,
} from "@/lib/queries";
import { computeFreshness } from "@/lib/freshness";
import { extractAnalytics } from "@/lib/utils";
import Link from "next/link";
import type { PortfolioAnalytics, PortfolioAlert } from "@/lib/types";
import type { OptimizerSuggestion } from "@/components/portfolio/PortfolioOptimizer";

// Next.js 16 forbids `ssr: false` on `next/dynamic` in Server Components.
// PortfolioOptimizer is a `"use client"` component so it will hydrate on
// the client regardless, and removing `ssr: false` just lets the empty-
// state SSR render on first paint without the extra loading blip.
const PortfolioOptimizer = dynamic(
  () => import("@/components/portfolio/PortfolioOptimizer"),
  {
    loading: () => (
      <Card>
        <Skeleton className="h-5 w-1/3 mb-4" />
        <SkeletonText lines={3} />
      </Card>
    ),
  },
);

/* ---------- State sub-components ---------- */

function EmptyState({ portfolioId }: { portfolioId: string }) {
  return (
    <Card className="text-center py-12">
      <p className="text-text-muted mb-2">This portfolio has no strategies yet.</p>
      <p className="text-sm text-text-secondary mb-6">
        Browse the marketplace and add strategies to start building your portfolio.
      </p>
      <Link
        href="/discovery/crypto-sma"
        className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
      >
        Add your first strategy
      </Link>
    </Card>
  );
}

function PendingState() {
  return (
    <Card className="text-center py-12">
      <p className="text-text-secondary">
        Strategies added. Analytics will compute once strategy data syncs.
      </p>
      <p className="mt-2 text-sm text-text-muted">
        This usually takes a few minutes after your first strategy connection.
      </p>
    </Card>
  );
}

function ComputingState() {
  return (
    <Card className="text-center py-12">
      <div className="flex items-center justify-center gap-2 text-text-secondary">
        <svg className="h-5 w-5 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Computing portfolio analytics...</span>
      </div>
      <p className="mt-2 text-sm text-text-muted">
        Calculating correlations, risk decomposition, and attribution.
      </p>
    </Card>
  );
}

function StaleWarning({ error }: { error: string | null }) {
  return (
    <div className="mb-6 rounded-lg border border-negative/30 bg-negative/5 px-4 py-3">
      <div className="flex items-start gap-2">
        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-negative" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 3a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 008 4zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z" />
        </svg>
        <div>
          <p className="text-sm font-medium text-negative">Analytics sync failed</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Showing last-good data.{error ? ` Error: ${error}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

function StaleConstituentWarning({ staleNames }: { staleNames: string[] }) {
  if (staleNames.length === 0) return null;
  const display =
    staleNames.length <= 2
      ? staleNames.join(" and ")
      : `${staleNames.slice(0, 2).join(", ")} +${staleNames.length - 2} more`;
  return (
    <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-2">
        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 3a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 008 4zm0 7a.75.75 0 100-1.5.75.75 0 000 1.5z" />
        </svg>
        <div>
          <p className="text-sm font-medium text-amber-800">Stale constituent data</p>
          <p className="mt-0.5 text-xs text-text-secondary">
            Portfolio includes {display} whose analytics are more than 48 hours old.
            Results may not reflect current performance.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Dashboard content (complete/stale states) ---------- */

function DashboardContent({
  analytics,
  strategies,
  alerts,
  portfolioId,
  optimizerSuggestions,
  optimizerComputedAt,
  optimizerStatus,
}: {
  analytics: PortfolioAnalytics;
  strategies: Awaited<ReturnType<typeof getPortfolioStrategies>>;
  alerts: PortfolioAlert[];
  portfolioId: string;
  optimizerSuggestions: OptimizerSuggestion[] | null;
  optimizerComputedAt: string | null;
  optimizerStatus: "pending" | "computing" | "complete" | "failed" | null;
}) {
  return (
    <div className="space-y-6">
      {/* Morning briefing zone */}
      {analytics.narrative_summary && (
        <Card>
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">
            Morning Briefing
          </p>
          <p className="text-sm text-text-secondary leading-relaxed">
            {analytics.narrative_summary}
          </p>
        </Card>
      )}

      {/* Alerts */}
      {alerts.length > 0 && <AlertsList alerts={alerts} />}

      {/* KPI row */}
      <PortfolioKPIRow analytics={analytics} />

      {/* Chart placeholders -- 2-col above 1024px, single below 768px */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        {/* Left: charts (60%) */}
        <div className="space-y-6">
          <Card className="min-h-[280px] flex items-center justify-center">
            <p className="text-sm text-text-muted">Equity curve chart (Task 11)</p>
          </Card>
          <Card className="min-h-[280px] flex items-center justify-center">
            <p className="text-sm text-text-muted">Attribution chart (Task 13)</p>
          </Card>
        </div>
        {/* Right: tables/heatmap (40%) */}
        <div className="space-y-6">
          <Card className="min-h-[280px] flex items-center justify-center">
            <p className="text-sm text-text-muted">Correlation heatmap (Task 12)</p>
          </Card>
          <Card className="min-h-[280px] flex items-center justify-center">
            <p className="text-sm text-text-muted">Benchmark comparison (Task 14)</p>
          </Card>
        </div>
      </div>

      {/* Strategy breakdown table */}
      <div>
        <h2 className="text-base font-semibold text-text-primary mb-3">Strategy Breakdown</h2>
        <StrategyBreakdownTable
          strategies={strategies as Parameters<typeof StrategyBreakdownTable>[0]["strategies"]}
          attribution={analytics.attribution_breakdown}
          portfolioId={portfolioId}
        />
      </div>

      {/* Diversification optimizer (lazy loaded, below the fold) */}
      <PortfolioOptimizer
        portfolioId={portfolioId}
        initialSuggestions={optimizerSuggestions}
        computedAt={optimizerComputedAt}
        computationStatus={optimizerStatus}
      />
    </div>
  );
}

/* ---------- Page ---------- */

export default async function PortfolioDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const portfolio = await getPortfolioDetail(id);
  if (!portfolio) redirect("/portfolios");

  const [strategies, analytics, alerts] = await Promise.all([
    getPortfolioStrategies(id),
    getPortfolioAnalytics(id),
    getPortfolioAlerts(id),
  ]);

  // DashboardShell state machine: empty | pending | computing | stale | complete
  const state =
    strategies.length === 0
      ? "empty"
      : !analytics
        ? "pending"
        : analytics.computation_status === "computing"
          ? "computing"
          : analytics.computation_status === "failed"
            ? "stale"
            : "complete";

  // Surface any constituent strategy whose analytics are stale so the allocator
  // knows the portfolio view may be out of date at the source.
  const staleConstituents: string[] = [];
  for (const ps of strategies) {
    const strategy = (ps as { strategies?: { name?: string; strategy_analytics?: unknown } })
      .strategies;
    if (!strategy) continue;
    const sAnalytics = extractAnalytics(strategy.strategy_analytics);
    if (!sAnalytics) continue;
    if (computeFreshness(sAnalytics.computed_at) === "stale") {
      staleConstituents.push(strategy.name ?? "unknown");
    }
  }

  return (
    <>
      <PageHeader
        title={portfolio.name}
        description={portfolio.description ?? undefined}
        meta={
          analytics?.computed_at ? (
            <FreshnessBadge
              computedAt={analytics.computed_at}
              label="Analytics"
              variant="pill"
            />
          ) : undefined
        }
        actions={
          state === "complete" || state === "stale" ? (
            <div className="flex items-center gap-2">
              <a
                href={`/api/portfolio-pdf/${id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-md border border-border bg-white px-4 py-2 text-sm font-medium text-text-primary hover:bg-page transition-colors"
              >
                Export PDF
              </a>
              <Link
                href={`/portfolios/${id}/manage`}
                className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
              >
                Manage
              </Link>
            </div>
          ) : undefined
        }
      />

      {state === "empty" && <EmptyState portfolioId={id} />}
      {state === "pending" && <PendingState />}
      {state === "computing" && <ComputingState />}
      {state === "stale" && analytics && (
        <StaleWarning error={analytics.computation_error} />
      )}
      {(state === "complete" || state === "stale") && (
        <StaleConstituentWarning staleNames={staleConstituents} />
      )}
      {(state === "complete" || state === "stale") && analytics && (
        <DashboardContent
          analytics={analytics}
          strategies={strategies}
          alerts={alerts}
          portfolioId={id}
          optimizerSuggestions={
            (analytics.optimizer_suggestions as OptimizerSuggestion[] | null) ??
            null
          }
          optimizerComputedAt={analytics.computed_at ?? null}
          optimizerStatus={null}
        />
      )}
      <Disclaimer />
    </>
  );
}
