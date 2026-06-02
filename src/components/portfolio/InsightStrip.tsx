"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PortfolioAnalytics } from "@/lib/types";
import {
  computeAllInsights,
  type PortfolioInsight,
  type RebalanceDriftInput,
} from "@/lib/portfolio-insights";
import { BridgeTrigger } from "./BridgeTrigger";

/**
 * `<InsightStrip>` — Moment 2 ("what I didn't know") rendered as a tight
 * row of plain-English sentences. Reads `analytics` and runs every insight
 * rule via `computeAllInsights`.
 *
 * When zero rules fire AND there are no flagged holdings, the strip renders
 * nothing (returns null) — there is no empty-state fallback copy (PR3
 * dashboard-parity decision; see the early-return comment below). Presence
 * of the section is itself the signal.
 *
 * When an underperformance insight targets a specific strategy, the sentence
 * is wrapped in `<BridgeTrigger>` which renders a "Find Replacement" link
 * and opens the ReplacementPanel slide-out on click.
 */

export interface InsightStripProps {
  analytics: PortfolioAnalytics | null;
  /** Portfolio ID — required for bridge triggers to call /api/bridge. */
  portfolioId?: string | null;
  /** Maximum number of insights to render. Default 3. */
  max?: number;
  /**
   * Optional strategy weight inputs for the rebalance_drift rule. When
   * omitted the rule is skipped entirely.
   */
  portfolioStrategies?: RebalanceDriftInput[] | null;
  /**
   * Portfolio age in days. Rebalance drift is suppressed for the first 7
   * days (honeymoon). Omit to skip the rule.
   */
  portfolioAgeDays?: number;
  className?: string;
  /**
   * Phase 09 / D-07 + finding f5. When > 0, prepends a dedicated line
   * "Bridge flagged N holding(s) — Review in Scenario →" that links to
   * /allocations?tab=scenario. Hidden entirely when 0 or undefined.
   * No empty-state copy — presence is the signal.
   */
  flaggedCount?: number;
}

type Severity = "high" | "medium" | "low";

const SEVERITY_DOT: Record<Severity, string> = {
  high: "bg-negative",
  medium: "bg-amber-500",
  low: "bg-text-muted",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  high: "High severity",
  medium: "Medium severity",
  low: "Low severity",
};

/** Returns true when an insight can activate the bridge trigger. */
function isBridgeable(insight: PortfolioInsight, portfolioId?: string | null): boolean {
  return (
    insight.key === "underperformance" &&
    !!insight.strategy_id &&
    !!portfolioId
  );
}

export function InsightStrip({
  analytics,
  portfolioId,
  max = 3,
  portfolioStrategies,
  portfolioAgeDays,
  className,
  flaggedCount,
}: InsightStripProps) {
  // Memoized so unrelated parent re-renders (the dashboard shell is a
  // `"use client"` component with its own state, and Overview fires a 30s
  // router.refresh) don't re-run the insight rules. We call computeAllInsights
  // unconditionally: it handles a null `analytics` internally (the
  // analytics-keyed rules return null) but STILL surfaces an
  // analytics-independent rebalance-drift insight when portfolioStrategies +
  // portfolioAgeDays are supplied — so short-circuiting on `analytics === null`
  // would wrongly drop that insight.
  const insights = useMemo(
    () =>
      computeAllInsights(analytics, portfolioStrategies, portfolioAgeDays).slice(
        0,
        max,
      ),
    [analytics, portfolioStrategies, portfolioAgeDays, max],
  );

  // F1 (loud-fail discipline) — H-1081 / M-0896. The strip renders nothing
  // when no insights fire, which silently masks two distinct upstream
  // failures from a genuine "no portfolio / nothing to say yet" empty state:
  //
  //   H-1081: `analytics === null` WHILE a portfolioId is present. A loaded
  //     portfolio implies its analytics row was (or should have been)
  //     computed; null here means the upstream fetch/computation failed, not
  //     that there were simply no insights. computeAllInsights(null, …)
  //     returns [] for every analytics-keyed rule, so the strip vanishes with
  //     zero signal. Surface it so it shows up in the console/Sentry breadcrumb
  //     trail instead of disappearing.
  //   M-0896: analytics is present but portfolioId is null — analytics implies
  //     a portfolio, so this is an orphaned-analytics bug. It also silently
  //     drops the BridgeTrigger "Find Replacement" affordance (isBridgeable
  //     requires portfolioId) from underperformance insights.
  //
  // Logged from an effect (not render) so the render stays a pure function of
  // props. We do NOT change the render output: the layout contract (presence
  // is the signal, no empty-state copy) is unchanged — we only make the
  // failure observable.
  useEffect(() => {
    if (analytics === null && portfolioId) {
      console.error(
        "[InsightStrip] analytics is null for a loaded portfolio — insights silently suppressed (likely upstream analytics fetch/computation failure)",
        { portfolioId },
      );
    } else if (analytics !== null && !portfolioId) {
      console.error(
        "[InsightStrip] orphaned analytics — analytics computed but portfolioId is null; bridge 'Find Replacement' affordance silently dropped",
        { hasAnalytics: true },
      );
    }
  }, [analytics, portfolioId]);

  // PR3 (dashboard parity) — when zero insights fire AND no flagged
  // holdings, render nothing. The truth screenshot doesn't show the
  // "WHAT WE NOTICED → No unusual activity" empty state, and a loud
  // empty section above the Bridge banner pushes the rest of the
  // dashboard down. Returning null when there's nothing to say keeps
  // the layout flush with the truth.
  if (insights.length === 0 && !flaggedCount) {
    return null;
  }

  return (
    <section
      aria-label="Portfolio insights"
      className={cn("flex flex-col gap-3", className)}
    >
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        What we noticed
      </p>
      <ul role="list" className="space-y-2">
        {flaggedCount !== undefined && flaggedCount > 0 && (
          <li className="flex items-start gap-3 text-sm text-text-secondary">
            <span
              aria-hidden="true"
              className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full bg-text-muted"
            />
            <Link href="/allocations?tab=scenario" className="hover:underline">
              {`Bridge flagged ${flaggedCount} holding(s) — Review in Scenario →`}
            </Link>
          </li>
        )}
        {insights.map((insight) => (
          <li
            key={`${insight.key}${insight.strategy_id ? `:${insight.strategy_id}` : ""}`}
            className="flex items-start gap-3 text-sm text-text-secondary"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full",
                SEVERITY_DOT[insight.severity],
              )}
            />
            <span className="sr-only">{SEVERITY_LABEL[insight.severity]}:</span>
            {isBridgeable(insight, portfolioId) ? (
              <BridgeTrigger insight={insight} portfolioId={portfolioId!}>
                <span>{insight.sentence}</span>
              </BridgeTrigger>
            ) : (
              <span>{insight.sentence}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
