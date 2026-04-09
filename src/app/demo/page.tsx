// SECURITY BOUNDARY:
// All Supabase reads on this page MUST be parameterized by a value in
// `PERSONAS` (src/lib/personas.ts). The admin client is used because /demo
// is a public route — never add a query that reads an arbitrary `user_id`
// or `allocator_id` from `searchParams`. The persona enum lookup is the
// only sanctioned input transform.

import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayStrategyName } from "@/lib/strategy-display";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/utils";
import { getPersona, type PersonaKey } from "@/lib/personas";
import { warmupAnalytics } from "@/lib/warmup-analytics";
import { adaptPortfolioAnalytics } from "@/lib/portfolio-analytics-adapter";
import {
  resolveDemoRecommendations,
  type RecommendationRow,
} from "@/lib/demo-recommendations";
import { signDemoPdfToken } from "@/lib/demo-pdf-token";
import { isDemoPortfolioId } from "@/lib/demo";
import { EditorialHero } from "@/components/portfolio/EditorialHero";
import { CounterfactualStrip } from "@/components/portfolio/CounterfactualStrip";
import { MorningBriefing } from "@/components/portfolio/MorningBriefing";
import { WinnersLosersStrip } from "@/components/portfolio/WinnersLosersStrip";
import { InsightStrip } from "@/components/portfolio/InsightStrip";
import { WhatWedDoCard } from "@/components/portfolio/WhatWedDoCard";
import { NextFiveMillionCard } from "@/components/portfolio/NextFiveMillionCard";
import type { Strategy, StrategyAnalytics } from "@/lib/types";

// Force dynamic rendering. The demo is parameterized by a `?persona=` query
// param so we can't ISR-cache without per-persona variants. The page is
// cheap (5 parallel reads + 0 transforms) so per-request render is fine
// for the friend-meeting traffic profile.
export const dynamic = "force-dynamic";

interface PortfolioHoldingRow {
  strategy_id: string;
  current_weight: number | null;
  allocated_amount: number | null;
  strategy: Pick<
    Strategy,
    "id" | "name" | "codename" | "disclosure_tier" | "description"
  >;
  analytics: Pick<StrategyAnalytics, "cagr" | "sharpe" | "max_drawdown"> | null;
}

interface PersonaMeta {
  label: string;
  headline: string;
  descriptor: string;
}

// Single source of truth for per-persona display copy. Preserves the
// persona enum lookup pattern — the only sanctioned input transform on
// this public route.
const PERSONA_META: Record<PersonaKey, PersonaMeta> = {
  active: {
    label: "Active",
    headline: "Beat BTC on the way up. And on the way down.",
    descriptor:
      "Exchange-verified allocator portfolio review with manager recommendations and IC-ready reporting.",
  },
  cold: {
    label: "Cold",
    headline: "Diversified, but is it earning its weight?",
    descriptor:
      "Six strategies, low correlation, mediocre return. The over-diversification trap.",
  },
  stalled: {
    label: "Stalled",
    headline: "Concentrated. Confident. One drawdown away from a problem.",
    descriptor:
      "Two strategies carrying the book. Sharpe is great until it isn't.",
  },
};

const PERSONA_KEYS: PersonaKey[] = ["active", "cold", "stalled"];

interface DemoPageProps {
  searchParams: Promise<{ persona?: string | string[] }>;
}

export default async function DemoPage({ searchParams }: DemoPageProps) {
  // Side-effect only: keep the analytics service warm for whatever the
  // friend's colleague clicks next. Never blocks render.
  warmupAnalytics();

  const params = await searchParams;
  const { key: personaKey, allocatorId } = getPersona(params.persona);
  const persona = PERSONA_META[personaKey];

  const admin = createAdminClient();

  // Phase 1: parallel reads that don't depend on each other.
  const [profileRes, batchesRes, portfolioRes] = await Promise.all([
    admin
      .from("profiles")
      .select("id, display_name, company")
      .eq("id", allocatorId)
      .maybeSingle(),
    admin
      .from("match_batches")
      .select("id, computed_at")
      .eq("allocator_id", allocatorId)
      .order("computed_at", { ascending: false })
      .limit(2),
    admin
      .from("portfolios")
      .select("id, name, description")
      .eq("user_id", allocatorId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  // Log any Supabase .error fields from Phase 1 so a service-key expiry,
  // RLS misconfiguration, or network partition is visible in the logs
  // instead of silently falling through to the "Demo data is loading"
  // empty state. We still render the page — the admin client path is
  // never supposed to fail, so an error here is operationally severe.
  if (profileRes.error) {
    console.error("[demo] profile fetch failed:", profileRes.error);
  }
  if (batchesRes.error) {
    console.error("[demo] batches fetch failed:", batchesRes.error);
  }
  if (portfolioRes.error) {
    console.error("[demo] portfolio fetch failed:", portfolioRes.error);
  }

  const profile = profileRes.data;
  const batches = (batchesRes.data ?? []) as Array<{
    id: string;
    computed_at: string;
  }>;
  const portfolio = portfolioRes.data;

  // Phase 2: depends on portfolio.id. Fetch holdings + analytics +
  // recommendations in parallel; the recommendation resolver runs
  // independently against the batches list.
  const [holdingsRes, analyticsRes, recommendationsRes] = await Promise.all([
    portfolio?.id
      ? admin
          .from("portfolio_strategies")
          .select(
            `strategy_id, current_weight, allocated_amount,
             strategies (
               id, name, codename, disclosure_tier, description,
               strategy_analytics (cagr, sharpe, max_drawdown)
             )`,
          )
          .eq("portfolio_id", portfolio.id)
          .order("current_weight", { ascending: false })
      : Promise.resolve({ data: null }),
    portfolio?.id
      ? admin
          .from("portfolio_analytics")
          .select("*")
          .eq("portfolio_id", portfolio.id)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    resolveDemoRecommendations({ admin, batches }),
  ]);

  const holdings = adaptHoldings(holdingsRes.data ?? null);
  const analytics = adaptPortfolioAnalytics(analyticsRes.data);
  const { recommendations, fellBackToPrevious } = recommendationsRes;

  const hasPortfolio = holdings.length > 0;
  const hasRecommendations = recommendations.length > 0;
  const totalAllocated = holdings.reduce(
    (sum, h) => sum + (h.allocated_amount ?? 0),
    0,
  );

  // Build the editorial hero numbers from the (parsed) portfolio_analytics row.
  const benchmarkLabel = analytics?.benchmark_comparison?.symbol ?? "BTC";
  const heroNumbers = {
    portfolioTwr: analytics?.total_return_twr ?? null,
    benchmarkTwr: analytics?.benchmark_comparison?.benchmark_twr ?? null,
    portfolioMaxDrawdown: analytics?.portfolio_max_drawdown ?? null,
    benchmarkMaxDrawdown:
      // Benchmark drawdown isn't persisted today (analytics-service only
      // computes portfolio drawdown). The friend meeting plan defers a
      // BTC drawdown column until the multi-horizon attribution PR.
      null as number | null,
    benchmarkLabel,
  };

  // Sign the PDF download token only when the current persona has a
  // seeded portfolio that is ALSO on the public demo allowlist. Never
  // fall back to a different persona's ID — silent cross-wiring is the
  // worst case on a forwarded URL (colleague sees "Cold" in the hero
  // and downloads the "Active" report). If `DEMO_PDF_SECRET` is not
  // configured (local dev without env var), hide the CTA rather than
  // crash — the friend's environment always has the secret.
  const pdfHref = buildDemoPdfHref(portfolio?.id ?? null);

  return (
    <>
      <PersonaSwitcher current={personaKey} />

      <EditorialHero
        className="mt-2 sm:mt-6"
        headline={persona.headline}
        descriptor={persona.descriptor}
        numbers={heroNumbers}
        cta={
          pdfHref ? (
            <a
              href={pdfHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center rounded-md bg-accent px-5 text-sm font-medium text-white transition-colors hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              Download IC Report
            </a>
          ) : null
        }
      />

      <CounterfactualStrip
        className="mt-4"
        portfolioTwr={heroNumbers.portfolioTwr}
        benchmarkTwr={heroNumbers.benchmarkTwr}
        benchmarkLabel={benchmarkLabel}
      />

      {/* Verdict / Evidence divider */}
      <div className="my-10 border-t border-border" />

      {/* EVIDENCE BLOCK */}
      <MorningBriefing
        narrative={analytics?.narrative_summary}
        variant="dek"
      />

      {hasPortfolio && (
        <section className="mt-8">
          <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-3">
            {profile?.company || profile?.display_name || "Active Allocator LP"}
            {totalAllocated > 0 && (
              <>
                {" · "}
                {formatCurrency(totalAllocated)} allocated
              </>
            )}
          </p>
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
        </section>
      )}

      <WinnersLosersStrip
        className="mt-10"
        attribution={analytics?.attribution_breakdown ?? null}
      />

      <InsightStrip className="mt-10" analytics={analytics} />

      {/* Evidence / Action divider */}
      <div className="my-10 border-t border-border" />

      {/* ACTION BLOCK */}
      <WhatWedDoCard
        suggestions={analytics?.optimizer_suggestions ?? null}
      />
      <NextFiveMillionCard
        className="mt-8"
        suggestions={analytics?.optimizer_suggestions ?? null}
      />

      {/* Action / Appendix divider */}
      <div className="my-10 border-t border-border" />

      {/* APPENDIX — top matches and explainers */}
      {hasRecommendations && (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-base font-semibold text-text-primary">
              Top matches for this mandate
            </h2>
            {fellBackToPrevious && (
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

      {hasPortfolio && !hasRecommendations && (
        <p className="text-sm text-text-secondary">
          Recommendations computing — showing current portfolio composition.
        </p>
      )}

      {!hasPortfolio && !hasRecommendations && (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
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
        </div>
      )}

      {/* Footer secondary CTAs only — primary CTA is the IC Report. */}
      <footer className="mt-12 flex flex-wrap items-center gap-6 border-t border-border pt-6 text-xs text-text-muted">
        <Link
          href="/demo/founder-view"
          className="hover:text-accent"
        >
          Founder view →
        </Link>
        <Link href="/signup" className="hover:text-accent">
          Sign up
        </Link>
      </footer>
    </>
  );
}

function buildDemoPdfHref(portfolioId: string | null): string | null {
  if (!portfolioId || !isDemoPortfolioId(portfolioId)) return null;
  try {
    const token = signDemoPdfToken(portfolioId);
    return `/api/demo/portfolio-pdf/${portfolioId}?token=${token}`;
  } catch {
    return null;
  }
}

function adaptHoldings(rows: unknown): PortfolioHoldingRow[] {
  if (!Array.isArray(rows)) return [];
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const strategyRaw = row.strategies;
    const strategyObj =
      strategyRaw && typeof strategyRaw === "object" && !Array.isArray(strategyRaw)
        ? (strategyRaw as Record<string, unknown>)
        : null;
    const analyticsRaw = strategyObj?.strategy_analytics;
    const analyticsObj =
      analyticsRaw && typeof analyticsRaw === "object"
        ? (Array.isArray(analyticsRaw)
            ? (analyticsRaw[0] as Record<string, unknown> | undefined)
            : (analyticsRaw as Record<string, unknown>))
        : null;
    return {
      strategy_id: row.strategy_id as string,
      current_weight: (row.current_weight as number | null) ?? null,
      allocated_amount: (row.allocated_amount as number | null) ?? null,
      strategy: {
        id: (strategyObj?.id as string) ?? (row.strategy_id as string),
        name: (strategyObj?.name as string) ?? "",
        codename: (strategyObj?.codename as string | null) ?? null,
        disclosure_tier:
          (strategyObj?.disclosure_tier as PortfolioHoldingRow["strategy"]["disclosure_tier"]) ??
          undefined,
        description: (strategyObj?.description as string | null) ?? null,
      },
      analytics: analyticsObj
        ? {
            cagr: (analyticsObj.cagr as number | null) ?? null,
            sharpe: (analyticsObj.sharpe as number | null) ?? null,
            max_drawdown: (analyticsObj.max_drawdown as number | null) ?? null,
          }
        : null,
    };
  });
}

function PersonaSwitcher({ current }: { current: PersonaKey }) {
  // Touch target sizing: min-h-[44px] + min-w-[44px] meets WCAG 2.5.5
  // Target Size Level AAA AND the iOS HIG 44pt minimum. The text remains
  // text-xs for visual density; padding takes up the rest.
  const baseClass =
    "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-4 text-xs font-medium";
  return (
    <nav
      aria-label="Demo persona"
      className="flex items-center gap-1 self-end"
    >
      {PERSONA_KEYS.map((key) => {
        const isCurrent = key === current;
        const stateClass = isCurrent
          ? "bg-accent/10 text-accent"
          : "text-text-muted hover:text-text-primary";
        return (
          <Link
            key={key}
            href={`/demo?persona=${key}`}
            aria-current={isCurrent ? "page" : undefined}
            className={`${baseClass} ${stateClass}`}
          >
            {PERSONA_META[key].label}
          </Link>
        );
      })}
    </nav>
  );
}

function RecommendationCard({ rec }: { rec: RecommendationRow }) {
  const primaryReason =
    rec.reasons[0] ?? "Strong fit for this allocator's mandate.";
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
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
    </div>
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
