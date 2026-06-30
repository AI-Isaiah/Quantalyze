"use client";

import { useState } from "react";
import { formatPercent } from "@/lib/utils";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { SegmentedControl } from "@/components/strategy-v2/SegmentedControl";
import { Button } from "@/components/ui/Button";
import type { DailyPoint } from "@/lib/scenario";

/**
 * Plan 28-02 (OPT-01 + OPT-02) — the user-visible "Suggested weights" section,
 * mounted in the own-book ScenarioComposer after the Monte-Carlo section. It
 * asks the Python analytics-service (via the allocator-authed /api/scenario/
 * optimize route) for long-only, sum-to-1 weights for an objective, previews
 * them with the mandatory in-sample caveat, and writes them to the editable
 * DRAFT only on an explicit "Apply" — NEVER auto-committing.
 *
 * Honesty invariants (test-pinned in WeightOptimizerSection.test.tsx):
 *   - The compute lives entirely in Python; this owns NO optimization math —
 *     only the request lifecycle + the apply-to-draft trigger.
 *   - A degenerate / under-sampled result (ok=false, weights=null) renders an
 *     honest, reason-routed empty state — NEVER a fabricated weight vector.
 *   - The in-sample caveat is ALWAYS shown with the weights (never a forecast).
 *   - Weights apply to the draft ONLY on the explicit Apply click (the parent
 *     writes them ATOMICALLY via applyWeightOverrides); nothing auto-commits.
 *   - < 2 active strategies ⇒ the "add at least 2" empty state (no request).
 *   - If the selection changes between Suggest and Apply, the stale weights are
 *     refused (re-run) rather than applied to a mismatched set (H1).
 */

interface OptimizerStrategy {
  id: string;
  name: string;
  dailyReturns: DailyPoint[];
}

interface OptimizeResult {
  ok: boolean;
  objective: string;
  n: number;
  k: number;
  weights: Record<string, number> | null;
  in_sample: boolean;
  reason: string;
}

type Objective = "min_vol" | "max_sharpe";

const OBJECTIVE_OPTIONS = [
  { id: "min_vol", label: "Min volatility" },
  { id: "max_sharpe", label: "Max Sharpe" },
] as const;

// Honest empty-state copy per the optimizer's `reason` (heading matches body, #509).
const REASON_COPY: Record<string, { heading: string; body: string }> = {
  "below-sample-gate": {
    heading: "Not enough history to optimize",
    body: "These strategies don't share enough overlapping days (relative to how many there are) for an honest covariance estimate. Pick strategies with longer common history.",
  },
  "constant-series": {
    heading: "Can't optimize a flat strategy",
    body: "One of the selected strategies has no return variation over the window, so an optimum isn't meaningful. Adjust the selection.",
  },
  "non-finite": {
    heading: "Can't optimize this selection",
    body: "The return data for one of these strategies isn't usable. Adjust the selection.",
  },
  "no-convergence": {
    heading: "Couldn't find an optimum",
    body: "The optimizer didn't converge for this selection. Try a different objective or selection.",
  },
  "no-positive-drift": {
    heading: "No positive risk-adjusted return to maximize",
    body: "Every selected strategy lost money over the shared window, so a max-Sharpe optimum would just pick the least-bad one. Try min-volatility, or a different selection.",
  },
};
const FALLBACK_EMPTY = {
  heading: "Couldn't suggest weights",
  body: "The optimizer couldn't produce weights for this selection. Try a different objective or selection.",
};

interface WeightOptimizerSectionProps {
  /** The active de-aliased strategies the optimizer allocates across. */
  strategies: OptimizerStrategy[];
  /** Apply suggested weights to the editable draft (id -> weight). DRAFT ONLY. */
  onApply: (weights: Record<string, number>) => void;
}

export function WeightOptimizerSection({ strategies, onApply }: WeightOptimizerSectionProps) {
  const [objective, setObjective] = useState<Objective>("min_vol");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [applied, setApplied] = useState(false);

  // < 2 active strategies — nothing to optimize across (mirror the Python gate).
  if (strategies.length < 2) {
    return (
      <EmptyStateCard
        heading="Suggested weights unavailable"
        body="Add at least 2 active strategies to the scenario to get suggested weights."
      />
    );
  }

  const requestWeights = async () => {
    setStatus("loading");
    setResult(null);
    setApplied(false);
    try {
      const series: Record<string, DailyPoint[]> = {};
      for (const s of strategies) series[s.id] = s.dailyReturns;
      const res = await fetch("/api/scenario/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ series, objective }),
      });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = (await res.json()) as OptimizeResult;
      setResult(data);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  const nameById = new Map(strategies.map((s) => [s.id, s.name]));

  // H1 — does this result's weight set still match the active selection? (The
  // selection can change between Suggest and Apply.)
  const okWeights = status === "done" && result?.ok && result.weights ? result.weights : null;
  const currentIds = new Set(strategies.map((s) => s.id));
  const weightIds = okWeights ? Object.keys(okWeights) : [];
  const selectionMatches =
    okWeights !== null &&
    weightIds.length === currentIds.size &&
    weightIds.every((id) => currentIds.has(id));

  return (
    <div>
      <h3 className="text-base font-semibold text-text-primary">Suggested weights</h3>
      <p className="mt-1 text-fixed-11 text-text-muted">
        A long-only allocation for the objective below, computed from the strategies&apos;
        overlapping history. Suggestions are <strong>in-sample</strong> (fit to the past, not a
        forecast) and write to your draft only — nothing is saved until you Save the scenario.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SegmentedControl
          options={[...OBJECTIVE_OPTIONS]}
          activeId={objective}
          onChange={(id) => setObjective(id as Objective)}
          ariaLabel="Optimization objective"
        />
        <Button onClick={requestWeights} disabled={status === "loading"} variant="secondary">
          {status === "loading" ? "Optimizing…" : "Suggest weights"}
        </Button>
      </div>

      {objective === "max_sharpe" && (
        <p className="mt-2 text-fixed-11 text-text-muted">
          Max-Sharpe maximizes the in-sample risk-adjusted return — it is the most
          overfit-prone objective; treat the weights as a starting point, not a recommendation.
        </p>
      )}

      {status === "loading" && (
        <div className="mt-3" data-testid="optimizer-loading">
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {status === "error" && (
        <div className="mt-3">
          <EmptyStateCard
            heading="Couldn't reach the optimizer"
            body="The optimizer is unavailable right now. Try again shortly."
          />
        </div>
      )}

      {status === "done" && result && (!result.ok || !result.weights) && (
        <div className="mt-3" data-testid="optimizer-empty">
          <EmptyStateCard
            heading={(REASON_COPY[result.reason] ?? FALLBACK_EMPTY).heading}
            body={(REASON_COPY[result.reason] ?? FALLBACK_EMPTY).body}
          />
        </div>
      )}

      {okWeights !== null && !selectionMatches && (
        <div className="mt-3" data-testid="optimizer-stale">
          <EmptyStateCard
            heading="Selection changed"
            body="Your strategy selection changed since these weights were computed. Re-run to get weights that match the current selection."
          />
        </div>
      )}

      {okWeights !== null && selectionMatches && (
        <div className="mt-3" data-testid="optimizer-result">
          <div className="overflow-hidden rounded-lg border border-border">
            {Object.entries(okWeights)
              .sort((a, b) => b[1] - a[1])
              .map(([id, w]) => (
                <div
                  key={id}
                  data-testid={`optimizer-weight-${id}`}
                  className="flex items-center justify-between border-b border-border/50 bg-surface px-4 py-2 last:border-b-0"
                >
                  <span className="text-xs text-text-secondary">{nameById.get(id) ?? id}</span>
                  <span className="text-xs font-metric text-text-secondary">{formatPercent(w)}</span>
                </div>
              ))}
          </div>
          <p className="mt-2 text-fixed-11 text-text-muted">
            {result!.objective === "min_vol" ? "Minimum-volatility" : "Maximum-Sharpe"} weights ·
            in-sample over {result!.n} overlapping days · Ledoit-Wolf shrinkage · not a forecast.
          </p>
          <div className="mt-3">
            <Button
              onClick={() => {
                onApply(okWeights);
                setApplied(true);
              }}
              variant="primary"
            >
              {applied ? "Applied to draft ✓" : "Apply to draft"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
