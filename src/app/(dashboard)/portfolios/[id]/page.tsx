import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { PortfolioKPIRow } from "@/components/portfolio/PortfolioKPIRow";
import { StrategyBreakdownTable } from "@/components/portfolio/StrategyBreakdownTable";
import {
  getPortfolioDetail,
  getPortfolioStrategies,
  getPortfolioAnalytics,
  getPortfolioAlerts,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { PortfolioAnalytics, PortfolioAlert } from "@/lib/types";

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

/* ---------- Alert severity badges ---------- */

const severityStyles: Record<string, string> = {
  high: "bg-negative/10 text-negative",
  medium: "bg-badge-market-neutral/10 text-badge-market-neutral",
  low: "bg-accent/10 text-accent",
};

function AlertsBanner({ alerts }: { alerts: PortfolioAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2 mb-6">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3"
        >
          <span
            className={cn(
              "inline-flex items-center rounded px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium",
              severityStyles[alert.severity] ?? severityStyles.low,
            )}
          >
            {alert.severity}
          </span>
          <p className="text-sm text-text-secondary">{alert.message}</p>
        </div>
      ))}
    </div>
  );
}

/* ---------- Dashboard content (complete/stale states) ---------- */

function DashboardContent({
  analytics,
  strategies,
  alerts,
  portfolioId,
}: {
  analytics: PortfolioAnalytics;
  strategies: Awaited<ReturnType<typeof getPortfolioStrategies>>;
  alerts: PortfolioAlert[];
  portfolioId: string;
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
      <AlertsBanner alerts={alerts} />

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

  return (
    <>
      <PageHeader
        title={portfolio.name}
        description={portfolio.description ?? undefined}
        actions={
          state === "complete" || state === "stale" ? (
            <Link
              href={`/portfolios/${id}/manage`}
              className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
            >
              Manage
            </Link>
          ) : undefined
        }
      />

      {state === "empty" && <EmptyState portfolioId={id} />}
      {state === "pending" && <PendingState />}
      {state === "computing" && <ComputingState />}
      {state === "stale" && analytics && (
        <StaleWarning error={analytics.computation_error} />
      )}
      {(state === "complete" || state === "stale") && analytics && (
        <DashboardContent
          analytics={analytics}
          strategies={strategies}
          alerts={alerts}
          portfolioId={id}
        />
      )}
    </>
  );
}
