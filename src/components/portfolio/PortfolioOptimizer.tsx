"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { cn, formatNumber, formatPercent } from "@/lib/utils";
import { RouteResponseError } from "@/lib/route-response-error";

/**
 * The one sentence shown when the failure did NOT come from a route response —
 * a rejected fetch, an unreadable body, anything whose own message is internal
 * noise. DESIGN.md §Voice: declarative, sentence-case, active voice, no
 * adjectives. "Retry" names the control that is rendered beside it.
 */
const OPTIMIZER_UNAVAILABLE_COPY =
  "We could not complete the optimizer run. Retry in a moment.";

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

/**
 * Per-metric unit (red-team F-2 honesty fix). The optimizer output mixes true
 * fractions with unitless quantities; rendering them all as `formatPercent`
 * (×100 + "%") turned a 0.45 CORRELATION into "+45.00%" and a 0.15 unitless
 * SHARPE delta into "+15.00%" — both misread as allocation/weight %s on the demo
 * page. Correlation is a −1..1 coefficient and Sharpe-lift is a unitless delta,
 * so both render as plain decimals; only `dd_improvement` (a reduction in the
 * portfolio's max drawdown, itself a fraction of NAV) is a genuine percentage.
 * This is a correctness fix on BOTH surfaces this component mounts on
 * (/allocations via OptimizerPanel AND /portfolios/[id]).
 */
type MetricUnit = "percent" | "decimal" | "signedDecimal";

function formatMetric(value: number | null, unit: MetricUnit): string {
  if (unit === "percent") return formatPercent(value);
  if (value == null || !Number.isFinite(value)) return "—";
  const decimal = formatNumber(value, 2); // negatives keep their natural "-".
  return unit === "signedDecimal" && value > 0 ? `+${decimal}` : decimal;
}

// Phase 100 / PI-05 (UI-SPEC W3): verbatim narrative tooltips on the metric
// labels. Also mounts on /portfolios/[id]:353. The `title` attribute + the
// per-metric `unit` formatting are the render surface; ordering and every other
// DOM node are unchanged.
function MetricCell({
  label,
  value,
  unit,
  tooltip,
}: {
  label: string;
  value: number | null;
  unit: MetricUnit;
  tooltip?: string;
}) {
  return (
    <div className="text-right">
      <p
        title={tooltip}
        className="text-micro uppercase tracking-wider text-text-muted font-medium"
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-small font-metric tabular-nums",
          liftClass(value),
        )}
      >
        {formatMetric(value, unit)}
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
        <p className="text-small font-semibold text-text-primary break-words min-w-0">
          {suggestion.strategy_name}
        </p>
        {/* Raw strategy_id is a legitimate single-line clip (not meaningful
            prose to recover) — audit :81 classified legitimate, left as-is. */}
        <p className="mt-0.5 font-mono text-micro text-text-muted truncate">
          {suggestion.strategy_id}
        </p>
      </div>
      <div className="flex items-center gap-4 sm:gap-6">
        <MetricCell
          label="Sharpe lift"
          value={suggestion.sharpe_lift}
          unit="signedDecimal"
          tooltip="Modeled change in your portfolio's Sharpe ratio if this strategy were added — a unitless delta, not a percentage. Positive means better risk-adjusted return in backtest."
        />
        <MetricCell
          label="Corr w/ portfolio"
          value={suggestion.corr_with_portfolio}
          unit="decimal"
          tooltip="Correlation of this strategy's daily returns with your current portfolio, from -1 to 1 (not a percentage). Lower means more diversification benefit."
        />
        <MetricCell
          label="DD improve"
          value={suggestion.dd_improvement}
          unit="percent"
          tooltip="Modeled reduction in your portfolio's maximum drawdown from adding this strategy, as a percentage of NAV."
        />
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/factsheet/${suggestion.strategy_id}`}
          className="text-caption font-medium text-accent hover:text-accent-hover underline-offset-2 hover:underline"
        >
          View strategy
        </Link>
        <Link
          href={`/portfolios/${portfolioId}/manage?add=${suggestion.strategy_id}`}
          className="inline-flex items-center justify-center rounded-md bg-accent px-3 py-1.5 text-caption font-medium text-white hover:bg-accent-hover transition-colors"
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
    // 140.3-07 / SEAMUX-09 / B-26 — invalidate BEFORE the refetch, not in the
    // catch. This is the locked house pattern, copied rather than re-invented
    // from `WeightOptimizerSection.tsx`'s `requestWeights` (`setResult(null)`)
    // and used identically at `admin/partner-import/page.tsx`. Without it a
    // failed re-run left the PREVIOUS ranked allocation mounted with live
    // "Add to portfolio" links under one small red line, which an allocator
    // reads as a current answer. Doing it here rather than in the catch also
    // covers the path where `router.refresh()` throws AFTER a successful
    // `setSuggestions` — the only way `error` could otherwise coexist with a
    // rendered ranking.
    setSuggestions(null);
    try {
      const res = await fetch("/api/portfolio-optimizer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: portfolioId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status === "failed") {
        // The route's `error` field is reviewed, scrubbed copy — on a breaker
        // trip it IS the single-source sentence from `src/lib/seam-copy.ts`,
        // and the route deliberately never puts `err.message` in it (M-0333).
        // Marking it as route-authored is what lets the catch below refuse to
        // render everything else without also deleting the breaker surface.
        throw new RouteResponseError(
          typeof data?.error === "string"
            ? data.error
            : `Optimizer failed (${res.status})`,
        );
      }
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      setLastComputedAt(new Date().toISOString());
      router.refresh();
    } catch (e) {
      // 140.3-07 / B-27 — the caught value goes to the console and never to the
      // user. A `TypeError` from a rejected fetch, or an undici transport
      // string, can carry an internal URL or header name; only a message this
      // component built from a route RESPONSE is safe to render.
      console.error("[PortfolioOptimizer] run failed:", e);
      setError(e instanceof RouteResponseError ? e.message : OPTIMIZER_UNAVAILABLE_COPY);
    } finally {
      setLoading(false);
    }
  }

  const heading = (
    <div className="mb-4">
      <h2 className="text-body font-semibold text-text-primary">
        Diversification Optimizer
      </h2>
      <p className="mt-0.5 text-caption text-text-muted">
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

  // 5. Failed — reachable from BOTH entry points.
  //
  // `computationStatus` is a SERVER-RENDERED prop. A client-side re-run failure
  // never updates it, so the original `computationStatus === "failed" &&
  // !suggestions` guard was unreachable after a re-run failure: with the
  // ranking now correctly discarded the user would have landed on the "never
  // run" empty state, which says "Run the optimizer to see strategies…" — a
  // false statement about what just happened.
  //
  // The `error` disjunct adds the client path; the original conjunct is left
  // byte-intact so the server path keeps working (TRAP-9). Placing this ABOVE
  // every other branch is also what guarantees no ranking can render while an
  // error is set, whatever order the states below are later rearranged in.
  if (error || (computationStatus === "failed" && !suggestions)) {
    return (
      <Card>
        {heading}
        <div className="rounded-lg border border-negative/30 bg-negative/5 px-4 py-3">
          <p className="text-small font-medium text-negative">
            Optimizer failed
          </p>
          <p className="mt-0.5 text-caption text-text-secondary">
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
        <p className="text-small text-text-secondary">
          Run the optimizer to see strategies that could improve your
          portfolio&apos;s risk-adjusted return.
        </p>
        {/* No inline `{error && …}` here: the failed branch above now returns
            on ANY error, so this state is only ever reached with `error` null.
            A second error surface that cannot render is how a reviewer loses
            track of which sites were closed. The failed card carries the same
            message plus a Retry control, so no affordance is lost. */}
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            {loading ? "Running..." : "Run Optimizer"}
          </Button>
        </div>
      </Card>
    );
  }

  // 3. Empty after compute
  if (suggestions.length === 0) {
    return (
      <Card>
        {heading}
        <p className="text-small text-text-secondary">
          No candidates match your current mandate. Try relaxing filters.
        </p>
        {/* Same reasoning as the empty state above — unreachable with `error`
            set, so the inline duplicate is gone rather than left as a second
            error surface that never renders. */}
        <div className="mt-4">
          <Button onClick={runOptimizer} disabled={loading}>
            {loading ? "Running..." : "Re-run Optimizer"}
          </Button>
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
          <p className="text-caption text-text-secondary">
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

      {/* This is the branch the stale ranking used to fall through to. It is
          now unreachable with `error` set — which is the whole point of
          SEAMUX-09, so the red line that used to sit under the live
          "Add to portfolio" links is gone with it. */}
      <div className="space-y-3">
        {top.map((s) => (
          <SuggestionRow
            key={s.strategy_id}
            suggestion={s}
            portfolioId={portfolioId}
          />
        ))}
      </div>
    </Card>
  );
}
