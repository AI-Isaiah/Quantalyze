import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { PortfolioKPIRow } from "@/components/portfolio/PortfolioKPIRow";
import { StrategyBreakdownTable } from "@/components/portfolio/StrategyBreakdownTable";
import { AlertsList } from "@/components/portfolio/AlertsList";
import { MorningBriefing } from "@/components/portfolio/MorningBriefing";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { FreshnessBadge } from "@/components/strategy/FreshnessBadge";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import {
  getPortfolioDetail,
  getPortfolioStrategies,
  getPortfolioAnalyticsWithFallback,
  getPortfolioAlerts,
  type PortfolioAnalyticsWithFallback,
} from "@/lib/queries";
import { adaptPortfolioAnalytics } from "@/lib/portfolio-analytics-adapter";
import { computeFreshness } from "@/lib/freshness";
import { extractAnalytics } from "@/lib/utils";
import Link from "next/link";
import type {
  PortfolioAnalytics,
  PortfolioAlert,
} from "@/lib/types";
import type { OptimizerSuggestion } from "@/components/portfolio/PortfolioOptimizer";

// Eagerly mount the small charts (above the fold). The heavy ones below the
// fold are lazy-loaded via next/dynamic to keep the dashboard's initial JS
// bundle in line with what /portfolios used to ship before the wiring PR.
import { PortfolioEquityCurve } from "@/components/portfolio/PortfolioEquityCurve";
import { CorrelationHeatmap } from "@/components/portfolio/CorrelationHeatmap";
import { AttributionBar } from "@/components/portfolio/AttributionBar";
import { BenchmarkComparison } from "@/components/portfolio/BenchmarkComparison";

const CompositionDonut = dynamic(
  () =>
    import("@/components/portfolio/CompositionDonut").then((m) => ({
      default: m.CompositionDonut,
    })),
  {
    loading: () => (
      <Card>
        <Skeleton className="h-5 w-1/3 mb-4" />
        <Skeleton className="h-40 w-full" />
      </Card>
    ),
  },
);

const RiskAttribution = dynamic(
  () =>
    import("@/components/portfolio/RiskAttribution").then((m) => ({
      default: m.RiskAttribution,
    })),
  {
    loading: () => (
      <Card>
        <Skeleton className="h-5 w-1/3 mb-4" />
        <SkeletonText lines={4} />
      </Card>
    ),
  },
);

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

function EmptyState() {
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

interface PortfolioStrategyRow {
  strategy_id: string;
  current_weight: number | null;
  allocated_amount: number | null;
  strategies?: {
    id: string;
    name: string;
    strategy_analytics?: unknown;
  } | null;
}

function buildCompositionRows(
  strategies: PortfolioStrategyRow[],
  attribution: PortfolioAnalytics["attribution_breakdown"],
) {
  return strategies
    .map((ps) => {
      const s = ps.strategies;
      if (!s) return null;
      const a = extractAnalytics(s.strategy_analytics);
      const attr = attribution?.find((x) => x.strategy_id === ps.strategy_id);
      return {
        id: s.id,
        name: s.name,
        weight: ps.current_weight ?? 0,
        amount: ps.allocated_amount,
        twr: attr?.contribution ?? a?.cagr ?? null,
        sharpe: a?.sharpe ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}

function buildEquityCurveSeries(
  strategies: PortfolioStrategyRow[],
): { id: string; name: string; equityCurve: { date: string; value: number }[] | null }[] {
  // Per-strategy equity curves come from `strategy_analytics.returns_series`
  // (cumulative-product transform). The wired chart receives an empty curve
  // when the underlying data is missing — this matches the existing behavior
  // before the wiring PR.
  return strategies
    .map((ps) => {
      if (!ps.strategies) return null;
      return {
        id: ps.strategies.id,
        name: ps.strategies.name,
        // Returns_series is not selected in the existing query (would balloon
        // the response). The chart still renders the portfolio composite line
        // by itself; per-strategy lines remain a future enhancement.
        equityCurve: null as { date: string; value: number }[] | null,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);
}

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
  strategies: PortfolioStrategyRow[];
  alerts: PortfolioAlert[];
  portfolioId: string;
  optimizerSuggestions: OptimizerSuggestion[] | null;
  optimizerComputedAt: string | null;
  optimizerStatus: "pending" | "computing" | "complete" | "failed" | null;
}) {
  // Defensive: re-parse the persisted JSONB through the adapter so the wired
  // charts always receive the strict shape (rather than the legacy DB types).
  const parsed = adaptPortfolioAnalytics(analytics);
  const attribution = parsed?.attribution_breakdown ?? null;
  const correlationMatrix = parsed?.correlation_matrix ?? null;
  const benchmarkComparison = parsed?.benchmark_comparison ?? null;
  const riskDecomposition = parsed?.risk_decomposition ?? null;
  const equityCurve = parsed?.portfolio_equity_curve ?? null;

  const compositionRows = buildCompositionRows(strategies, attribution);
  const equitySeries = buildEquityCurveSeries(strategies);
  const strategyNames: Record<string, string> = {};
  for (const ps of strategies) {
    if (ps.strategies) strategyNames[ps.strategy_id] = ps.strategies.name;
  }

  // The CorrelationHeatmap component is typed to require non-nullable cell
  // values. Replace nulls with 0 for rendering — accurate-enough for the UI,
  // and the heatmap visually distinguishes "no data" via its own check.
  const heatmapMatrix = correlationMatrix
    ? Object.fromEntries(
        Object.entries(correlationMatrix).map(([rowKey, row]) => [
          rowKey,
          Object.fromEntries(
            Object.entries(row).map(([colKey, val]) => [colKey, val ?? 0]),
          ),
        ]),
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Morning briefing zone */}
      {analytics.narrative_summary && (
        <MorningBriefing narrative={analytics.narrative_summary} />
      )}

      {/* Alerts */}
      {alerts.length > 0 && <AlertsList alerts={alerts} />}

      {/* KPI row */}
      <PortfolioKPIRow analytics={analytics} />

      {/* Equity curve + correlation — primary evidence panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        <Card>
          <h3 className="text-base font-semibold text-text-primary mb-3">
            Equity curve
          </h3>
          <PortfolioEquityCurve
            portfolioEquityCurve={equityCurve}
            strategies={equitySeries}
          />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-text-primary mb-3">
            Correlation
          </h3>
          <CorrelationHeatmap
            correlationMatrix={heatmapMatrix}
            strategyNames={strategyNames}
          />
        </Card>
      </div>

      {/* Attribution + benchmark */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">
        <Card>
          <h3 className="text-base font-semibold text-text-primary mb-3">
            Return attribution
          </h3>
          <AttributionBar data={attribution} />
        </Card>
        <BenchmarkComparison benchmarkComparison={benchmarkComparison} />
      </div>

      {/* Strategy breakdown table */}
      <div>
        <h2 className="text-base font-semibold text-text-primary mb-3">Strategy Breakdown</h2>
        <StrategyBreakdownTable
          strategies={strategies as Parameters<typeof StrategyBreakdownTable>[0]["strategies"]}
          attribution={attribution}
          portfolioId={portfolioId}
        />
      </div>

      {/* Below-the-fold lazy-loaded charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-base font-semibold text-text-primary mb-3">
            Composition
          </h3>
          <CompositionDonut strategies={compositionRows} />
        </Card>
        <Card>
          <h3 className="text-base font-semibold text-text-primary mb-3">
            Risk decomposition
          </h3>
          <RiskAttribution data={riskDecomposition} />
        </Card>
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

  const [strategies, analyticsBundle, alerts] = await Promise.all([
    getPortfolioStrategies(id),
    getPortfolioAnalyticsWithFallback(id),
    getPortfolioAlerts(id),
  ]);

  const analytics = chooseAnalytics(analyticsBundle);
  const state = resolveDashboardState(strategies, analytics);

  // Surface any constituent strategy whose analytics are stale so the allocator
  // knows the portfolio view may be out of date at the source.
  const staleConstituents: string[] = [];
  for (const ps of strategies) {
    if (!ps.strategies) continue;
    const sAnalytics = extractAnalytics(ps.strategies.strategy_analytics);
    if (!sAnalytics) continue;
    if (computeFreshness(sAnalytics.computed_at) === "stale") {
      staleConstituents.push(ps.strategies.name);
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

      {state === "empty" && <EmptyState />}
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

type DashboardState = "empty" | "pending" | "computing" | "stale" | "complete";

function resolveDashboardState(
  strategies: PortfolioStrategyRow[],
  analytics: PortfolioAnalytics | null,
): DashboardState {
  if (strategies.length === 0) return "empty";
  if (!analytics) return "pending";
  if (analytics.computation_status === "computing") return "computing";
  if (analytics.computation_status === "failed") return "stale";
  return "complete";
}

/**
 * Choose between the latest analytics row and the last successful one. If
 * the latest is in a failed state but a prior complete row exists, return
 * that one with the failed-status flag preserved so the dashboard still
 * shows a stale badge.
 */
function chooseAnalytics(
  bundle: PortfolioAnalyticsWithFallback,
): PortfolioAnalytics | null {
  const { latest, lastGood } = bundle;
  if (!latest) return null;
  if (latest.computation_status === "complete") return latest;
  if (latest.computation_status === "failed" && lastGood) {
    return {
      ...lastGood,
      // Preserve the failed-status signal so the dashboard renders a stale
      // badge instead of letting the user think the data is fresh.
      computation_status: "failed",
      computation_error:
        latest.computation_error ??
        "Latest computation failed; showing last-good values.",
    };
  }
  return latest;
}
