"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Card } from "@/components/ui/Card";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import type { OptimizerSuggestion } from "@/components/portfolio/PortfolioOptimizer";
import type { OptimizerPrefetch } from "../lib/watchlist-read";

/**
 * PI-05 (optimizer half) — a THIN /allocations wrapper around the shared
 * `PortfolioOptimizer` (mounted via next/dynamic exactly like
 * portfolios/[id]/page.tsx:68). This wrapper owns ONLY the concerns
 * PortfolioOptimizer does not: the portfolio selector, the 0-portfolio honest
 * gate, the mandatory ranked-list footer disclaimer, and the narrative metric
 * glossary (one entry per rendered column). PortfolioOptimizer already solves
 * pending/computing/failed/stale/skeleton + the refresh POST — none of that is
 * reimplemented here.
 *
 * HONESTY CONTRACT (scores, not weights): `/api/portfolio-optimizer` returns
 * SCORED strategy suggestions — a ranking, not an allocation. The panel renders
 * a ranked list sorted by `score` DESC (sorted HERE, in the wrapper, so the
 * shared component's /portfolios/[id] ordering stays byte-identical — SC-4).
 * The refresh path is PortfolioOptimizer's existing POST /api/portfolio-optimizer
 * ONLY — never the weights endpoint; never a pie/donut/weight-bar/"allocation %".
 *
 * 0-PORTFOLIO STATE (170.4 D-06, D-07): the "connect a key" prompt shows only
 * when the server-side `hasConnectedKeys` flag is not true. An allocator with an
 * eligible key and no portfolio is told that reason instead, with no connect
 * link. No portfolio is created automatically (deferred idea, not built). With a
 * portfolio but no analytics, PortfolioOptimizer's own never-run state names the
 * reason and no connect copy appears whatever the flag says.
 */

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

const FOOTER =
  "Ranked by modeled fit from historical daily returns — suggestions, not an allocation and not a forecast.";

/**
 * Honest metric glossary. Red-team F-2: every entry's label MUST match a column
 * actually rendered by PortfolioOptimizer ("Sharpe lift" / "Corr w/ portfolio" /
 * "DD improve") — the old glossary documented a "Score" column that is never
 * rendered (score only orders the list) and mislabelled the others, so a reader
 * could not map a tooltip to the column it describes. Copy also states the unit
 * (unitless delta / -1..1 coefficient / percentage) so no value reads as an
 * allocation %.
 */
const METRIC_TOOLTIPS: { label: string; copy: string }[] = [
  {
    label: "Sharpe lift",
    copy: "Modeled change in your portfolio's Sharpe ratio if this strategy were added — a unitless delta, not a percentage. Positive means better risk-adjusted return in backtest.",
  },
  {
    label: "Corr w/ portfolio",
    copy: "Correlation of this strategy's daily returns with your current portfolio, from -1 to 1 (not a percentage). Lower means more diversification benefit.",
  },
  {
    label: "DD improve",
    copy: "Modeled reduction in your portfolio's maximum drawdown from adding this strategy, as a percentage of NAV.",
  },
];

/** Rank by score DESC; a null score sorts last (unrankable, never fabricated). */
function sortByScoreDesc(
  suggestions: OptimizerSuggestion[] | null,
): OptimizerSuggestion[] | null {
  if (suggestions == null) return null;
  return [...suggestions].sort(
    (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity),
  );
}

export function OptimizerPanel({
  prefetch,
  hasConnectedKeys = false,
}: {
  prefetch: OptimizerPrefetch;
  /**
   * 170.4 D-06 / D-07: the server-side "has an eligible key" predicate
   * (`apiKeys.some(isPerKeyDailiesEligibleKey)` in src/lib/queries.ts), carried
   * in the dashboard payload. Never derived from `portfolios` or holdings.
   * Defaults to false (a harness supplying nothing asserts no key), which is
   * the pre-170.4 behaviour.
   */
  hasConnectedKeys?: boolean;
}) {
  const [portfolioId, setPortfolioId] = useState<string | null>(
    prefetch.defaultPortfolioId,
  );

  const heading = (
    <div className="mb-1">
      <h3 className="text-h3 font-semibold text-text-primary">
        Diversification Optimizer
      </h3>
      <p className="mt-0.5 text-caption text-text-muted">
        Strategies modeled to improve your portfolio&apos;s risk-adjusted return.
      </p>
    </div>
  );

  // 0-portfolio honest gate — PortfolioOptimizer is NOT mounted, no fake rows.
  if (prefetch.portfolios.length === 0 || portfolioId == null) {
    // 170.4 D-06: with an eligible key the remedy is NOT "connect a key" — the
    // allocator has one. No portfolio is created automatically (deferred idea);
    // the owner-scoped allocation route provisions the real portfolio on the
    // first allocation (src/app/api/portfolio-strategies/allocation/route.ts).
    if (hasConnectedKeys) {
      return (
        <Card>
          {heading}
          <p className="mt-3 text-small font-medium text-text-primary">
            Simulate Impact needs a portfolio
          </p>
          <p className="mt-1 text-small text-text-secondary">
            Your exchange keys are connected, but you have no portfolio yet. A
            portfolio starts when you allocate to a strategy.
          </p>
        </Card>
      );
    }
    return (
      <Card>
        {heading}
        <p className="mt-3 text-small font-medium text-text-primary">
          Simulate Impact needs a live portfolio
        </p>
        <p className="mt-1 text-small text-text-secondary">
          Connect a read-only exchange API key to build your allocation, then
          Simulate Impact models new strategies against it.
        </p>
        <Link
          href="/profile?tab=exchanges"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-white px-3 py-1.5 text-caption font-medium text-text-primary transition-colors hover:bg-page"
        >
          Connect Exchange →
        </Link>
      </Card>
    );
  }

  const isDefault = portfolioId === prefetch.defaultPortfolioId;
  // Only the default portfolio has persisted suggestions; a switch resets to the
  // component's own pending flow (null initials).
  const initialSuggestions = isDefault
    ? sortByScoreDesc(prefetch.initialSuggestions)
    : null;
  const computedAt = isDefault ? prefetch.computedAt : null;
  const computationStatus = isDefault ? prefetch.computationStatus : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {heading}
        {prefetch.portfolios.length >= 2 && (
          <select
            aria-label="Select portfolio"
            value={portfolioId}
            onChange={(e) => setPortfolioId(e.target.value)}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-caption text-text-primary focus-visible:border-accent focus-visible:outline-none"
          >
            {prefetch.portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Reused, unmodified degraded/success states. key remounts on switch. */}
      <PortfolioOptimizer
        key={portfolioId}
        portfolioId={portfolioId}
        initialSuggestions={initialSuggestions}
        computedAt={computedAt}
        computationStatus={computationStatus}
      />

      {/* Honest metric glossary — one entry per rendered column label. */}
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        {METRIC_TOOLTIPS.map(({ label, copy }) => (
          <div key={label} className="flex items-center">
            <dt
              tabIndex={0}
              title={copy}
              aria-label={`${label}: ${copy}`}
              className="cursor-help border-b border-dotted border-text-muted text-micro font-medium uppercase tracking-wider text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              {label}
            </dt>
          </div>
        ))}
      </dl>

      <p className="text-caption text-text-muted">{FOOTER}</p>
    </div>
  );
}
