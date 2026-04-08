import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { displayStrategyName } from "@/lib/strategy-display";
import {
  formatPercent,
  formatNumber,
  formatCurrency,
  extractAnalytics,
} from "@/lib/utils";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

// Never cache — the friend clicking the Telegram link should see a fresh
// batch on every visit so a background recompute shows up immediately.
// The multi-step fallback (latest → previous batch → portfolio-only) is
// intentional: design review flagged the "Refresh in 1 minute" empty state
// as a demo-killer.
export const dynamic = "force-dynamic";

const ALLOCATOR_ACTIVE_ID = "aaaaaaaa-0001-4000-8000-000000000002";

type StrategySummary = Pick<
  Strategy,
  "id" | "name" | "codename" | "disclosure_tier" | "description"
>;

type AnalyticsSummary = Pick<
  StrategyAnalytics,
  "cagr" | "sharpe" | "max_drawdown"
>;

interface RecommendationRow {
  id: string;
  rank: number | null;
  score: number;
  reasons: string[];
  strategy: StrategySummary;
  analytics: AnalyticsSummary | null;
}

interface PortfolioHoldingRow {
  strategy_id: string;
  current_weight: number | null;
  allocated_amount: number | null;
  strategy: StrategySummary;
  analytics: AnalyticsSummary | null;
}

function toAnalyticsSummary(raw: unknown): AnalyticsSummary | null {
  const analytics = extractAnalytics(raw);
  if (!analytics) return null;
  return {
    cagr: analytics.cagr,
    sharpe: analytics.sharpe,
    max_drawdown: analytics.max_drawdown,
  };
}

function extractStrategy(raw: unknown): StrategySummary | null {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    name: (r.name as string) ?? "",
    codename: (r.codename as string | null) ?? null,
    disclosure_tier:
      (r.disclosure_tier as StrategySummary["disclosure_tier"]) ?? undefined,
    description: (r.description as string | null) ?? null,
  };
}

async function fetchCandidatesForBatch(
  admin: ReturnType<typeof createAdminClient>,
  batchId: string,
): Promise<RecommendationRow[]> {
  const { data: rows } = await admin
    .from("match_candidates")
    .select(
      `id, rank, score, reasons, exclusion_reason,
       strategies!inner (
         id, name, codename, disclosure_tier, description,
         strategy_analytics (cagr, sharpe, max_drawdown)
       )`,
    )
    .eq("batch_id", batchId)
    .is("exclusion_reason", null)
    .not("rank", "is", null)
    .order("rank", { ascending: true })
    .limit(3);

  return (rows ?? []).map((row: Record<string, unknown>) => {
    const strategyRaw = row.strategies;
    const strategy = extractStrategy(strategyRaw);
    const analytics = toAnalyticsSummary(
      strategy
        ? ((strategyRaw as Record<string, unknown>).strategy_analytics as unknown)
        : null,
    );
    return {
      id: row.id as string,
      rank: (row.rank as number | null) ?? null,
      score: (row.score as number) ?? 0,
      reasons: (row.reasons as string[] | null) ?? [],
      strategy: strategy ?? {
        id: row.strategy_id as string,
        name: "",
        codename: null,
        disclosure_tier: undefined,
        description: null,
      },
      analytics,
    };
  });
}

export default async function DemoPage() {
  const admin = createAdminClient();

  // 1. Fetch allocator profile + latest two batches + portfolio in parallel.
  // We grab TWO batches so we can fall back to the previous one if the
  // latest is empty (design review fallback chain).
  const [profileRes, batchesRes, portfolioRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, company")
      .eq("id", ALLOCATOR_ACTIVE_ID)
      .maybeSingle(),
    admin
      .from("match_batches")
      .select("id, computed_at, mode, candidate_count")
      .eq("allocator_id", ALLOCATOR_ACTIVE_ID)
      .order("computed_at", { ascending: false })
      .limit(2),
    admin
      .from("portfolios")
      .select("id, name, description")
      .eq("user_id", ALLOCATOR_ACTIVE_ID)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  const profile = profileRes.data;
  const batches = (batchesRes.data ?? []) as Array<{ id: string; computed_at: string }>;
  const portfolio = portfolioRes.data;

  // 2. Fallback chain: latest batch → previous batch.
  let recommendations: RecommendationRow[] = [];
  let usedBatchId: string | null = null;
  if (batches[0]) {
    recommendations = await fetchCandidatesForBatch(admin, batches[0].id);
    if (recommendations.length > 0) {
      usedBatchId = batches[0].id;
    } else if (batches[1]) {
      // The latest batch has zero candidates — fall back to the previous
      // batch so the friend doesn't land on an empty page.
      recommendations = await fetchCandidatesForBatch(admin, batches[1].id);
      if (recommendations.length > 0) {
        usedBatchId = batches[1].id;
      }
    }
  }

  // 3. Fetch portfolio holdings (always, so we have last-known-good even
  // if the match engine produced nothing yet).
  let holdings: PortfolioHoldingRow[] = [];
  if (portfolio?.id) {
    const { data: holdingRows } = await admin
      .from("portfolio_strategies")
      .select(
        `strategy_id, current_weight, allocated_amount,
         strategies (
           id, name, codename, disclosure_tier, description,
           strategy_analytics (cagr, sharpe, max_drawdown)
         )`,
      )
      .eq("portfolio_id", portfolio.id)
      .order("current_weight", { ascending: false });

    holdings = ((holdingRows ?? []) as Array<Record<string, unknown>>).map((row) => {
      const strategyRaw = row.strategies;
      const strategy = extractStrategy(strategyRaw);
      const analytics = toAnalyticsSummary(
        strategy
          ? ((strategyRaw as Record<string, unknown>).strategy_analytics as unknown)
          : null,
      );
      return {
        strategy_id: row.strategy_id as string,
        current_weight: (row.current_weight as number | null) ?? null,
        allocated_amount: (row.allocated_amount as number | null) ?? null,
        strategy: strategy ?? {
          id: row.strategy_id as string,
          name: "",
          codename: null,
          disclosure_tier: undefined,
          description: null,
        },
        analytics,
      };
    });
  }

  const hasPortfolio = holdings.length > 0;
  const hasRecommendations = recommendations.length > 0;
  const totalAllocated = holdings.reduce(
    (sum, h) => sum + (h.allocated_amount ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title={
          profile?.company || profile?.display_name
            ? `${profile.company || profile.display_name}`
            : "Active Allocator LP"
        }
        description="Live view of an allocator's portfolio and top matches."
      />

      {/* When the match engine has NEVER produced a batch AND there's no
          seeded portfolio, show a short explanatory card. In practice the
          seed script always creates both, so this path is defensive only. */}
      {!hasPortfolio && !hasRecommendations && (
        <Card className="p-8 text-center">
          <h2 className="text-base font-semibold text-text-primary">
            Demo data is loading
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-text-secondary">
            The simulated allocator state is being seeded. Check back in a
            moment — or{" "}
            <Link href="/signup" className="underline hover:text-text-primary">
              sign up
            </Link>{" "}
            to build your own.
          </p>
        </Card>
      )}

      {/* Portfolio card — always first. Serves as last-known-good if the
          match engine produced nothing usable. */}
      {hasPortfolio && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Current portfolio
          </h2>
          <Card>
            <div className="flex items-baseline justify-between gap-4 border-b border-border pb-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-text-muted">
                  {portfolio?.name || "Active Allocator Portfolio"}
                </p>
                <p className="mt-1 text-sm text-text-secondary">
                  {holdings.length} strategies · seeded demo data
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wider text-text-muted">
                  Total allocated
                </p>
                <p className="font-metric tabular-nums text-xl text-text-primary">
                  {totalAllocated > 0 ? formatCurrency(totalAllocated) : "—"}
                </p>
              </div>
            </div>

            <ul className="divide-y divide-border">
              {holdings.map((h) => (
                <li
                  key={h.strategy_id}
                  className="flex items-center justify-between gap-4 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-base text-text-primary">
                      {displayStrategyName(h.strategy)}
                    </p>
                    {h.strategy.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-text-muted">
                        {h.strategy.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                      <Metric
                        label="CAGR"
                        value={formatPercent(h.analytics?.cagr)}
                      />
                      <Metric
                        label="Sharpe"
                        value={formatNumber(h.analytics?.sharpe)}
                      />
                      <Metric
                        label="Max DD"
                        value={formatPercent(h.analytics?.max_drawdown)}
                        negative
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-metric tabular-nums text-base text-text-primary">
                      {h.current_weight != null
                        ? `${(h.current_weight * 100).toFixed(0)}%`
                        : "—"}
                    </p>
                    <p className="font-metric tabular-nums text-xs text-text-muted">
                      {h.allocated_amount != null && h.allocated_amount > 0
                        ? formatCurrency(h.allocated_amount)
                        : "—"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {/* Recommendations — top 3 candidates from the latest (or fallback)
          batch. If there's truly nothing, suppress the section heading so
          the portfolio card still reads as a complete page. */}
      {hasRecommendations && (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold text-text-primary">
              Top matches for this mandate
            </h2>
            {usedBatchId && batches[0] && usedBatchId !== batches[0].id && (
              <span className="text-xs text-text-muted">
                Showing previous batch (latest computing)
              </span>
            )}
          </div>
          <ol className="space-y-4">
            {recommendations.map((rec) => (
              <li key={rec.id}>
                <RecommendationCard rec={rec} />
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Recommendations fall-back note — only when we HAVE a portfolio but
          the match engine produced nothing. Never "Refresh in 1 minute". */}
      {hasPortfolio && !hasRecommendations && (
        <Card className="p-6">
          <p className="text-sm text-text-secondary">
            Recommendations computing — showing current portfolio composition.
          </p>
        </Card>
      )}

      {/* Secondary CTA — a second touchpoint to /signup for readers who
          scrolled past the banner. */}
      <Card className="mt-10 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">
            See how the founder reviews this queue.
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Open the read-only founder view to watch the match workflow.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/demo/founder-view"
            className="inline-flex items-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:border-accent hover:text-accent"
          >
            Founder view →
          </Link>
          <Link
            href="/signup"
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Sign up
          </Link>
        </div>
      </Card>
    </>
  );
}

function RecommendationCard({ rec }: { rec: RecommendationRow }) {
  const primaryReason = rec.reasons[0] ?? "Strong fit for this allocator's mandate.";
  return (
    <Card>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
              #{rec.rank ?? "—"}
            </span>
            <h3 className="font-display text-base text-text-primary">
              {displayStrategyName(rec.strategy)}
            </h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {primaryReason}
          </p>
          {rec.strategy.description && (
            <p className="mt-2 line-clamp-2 text-xs text-text-muted">
              {rec.strategy.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <Metric label="CAGR" value={formatPercent(rec.analytics?.cagr)} />
            <Metric label="Sharpe" value={formatNumber(rec.analytics?.sharpe)} />
            <Metric
              label="Max DD"
              value={formatPercent(rec.analytics?.max_drawdown)}
              negative
            />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs uppercase tracking-wider text-text-muted">
            Score
          </p>
          <p className="font-metric tabular-nums text-2xl text-text-primary">
            {rec.score.toFixed(0)}
          </p>
        </div>
      </div>
    </Card>
  );
}

function Metric({
  label,
  value,
  negative,
}: {
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <span
        className={`font-metric tabular-nums font-medium ${
          negative ? "text-negative" : "text-text-primary"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
