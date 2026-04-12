import { cn } from "@/lib/utils";
import type { PortfolioAnalytics } from "@/lib/types";
import { computeAllInsights, type PortfolioInsight } from "@/lib/portfolio-insights";
import { BridgeTrigger } from "./BridgeTrigger";

/**
 * `<InsightStrip>` — Moment 2 ("what I didn't know") rendered as a tight
 * row of plain-English sentences. Reads `analytics` and runs every insight
 * rule via `computeAllInsights`.
 *
 * If zero rules fire, the strip stays visible with a fallback "No unusual
 * activity" sentence so the layout doesn't shift mid-page.
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
  className?: string;
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
  className,
}: InsightStripProps) {
  const insights = computeAllInsights(analytics).slice(0, max);

  return (
    <section
      aria-label="Portfolio insights"
      className={cn("flex flex-col gap-3", className)}
    >
      <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium">
        What we noticed
      </p>
      {insights.length === 0 ? (
        <p className="text-sm text-text-secondary">
          No unusual activity in the trailing window.
        </p>
      ) : (
        <ul role="list" className="space-y-2">
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
                <BridgeTrigger
                  insight={insight}
                  portfolioId={portfolioId!}
                >
                  <span>{insight.sentence}</span>
                </BridgeTrigger>
              ) : (
                <span>{insight.sentence}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
