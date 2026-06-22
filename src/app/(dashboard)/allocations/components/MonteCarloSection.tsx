"use client";

import { useEffect, useState } from "react";
import { formatPercent } from "@/lib/utils";
import { methodologyLine } from "@/lib/scenario-history";
import {
  evaluateSampleFloor,
  SAMPLE_FLOOR_OVERLAPPING_DAYS,
} from "@/lib/sample-floor";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { SampleFloorEmptyState } from "@/components/scenarios/SampleFloorEmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import type { DailyPoint } from "@/lib/scenario";
import { MC_PATHS_DEFAULT, MC_HORIZON_DEFAULT, type MonteCarloResult } from "../lib/scenario-montecarlo";
import { runMonteCarloOffThread, type MonteCarloRun } from "../lib/montecarlo-runner";
import { MonteCarloBandChart } from "./MonteCarloBandChart";

/**
 * Plan 27-02 (SIM-01) — the user-visible "Forward uncertainty" section, mounted
 * in the own-book ScenarioComposer immediately after the StressVarSection. It
 * runs a block-bootstrap forward simulation OFF THE MAIN THREAD (a Web Worker,
 * via `runMonteCarloOffThread`) and renders confidence bands + a mandatory
 * disclosure, OR an honest empty/computing/error state. ALL math is delegated to
 * the golden, deterministic `runMonteCarlo` (Plan 27-01) — this component owns
 * NONE of the arithmetic, only the worker lifecycle + the UI contract
 * (27-UI-SPEC.md).
 *
 * Honesty invariants (test-pinned in MonteCarloSection.test.tsx):
 *   - Fixed guard order (#509): the SYNCHRONOUS, cheap gates run BEFORE the
 *     worker is ever spawned — scenario-side absence → below the Phase-22 floor.
 *     Only then do we spawn the worker (computing) → error / ok. Each empty-state
 *     heading matches its body.
 *   - The sample floor is the imported `SAMPLE_FLOOR_OVERLAPPING_DAYS` SoT, never
 *     a re-declared literal 60.
 *   - The disclosure is never a bare band: the ok state always names the method,
 *     path count, block length, overlapping-N, and the "not a Normal model · not
 *     a forecast" framing.
 *   - Em-dash discipline: a null terminal value renders "—", never a fabricated 0.
 *   - The worker is debounced (no spawn-per-keystroke), torn down on unmount /
 *     superseded input, and a late result from a stale run is ignored.
 */

const MC_DEBOUNCE_MS = 250;

// Empty-state copy (27-UI-SPEC §Copywriting — verbatim; heading MUST match body, #509).
const NO_SCENARIO_RETURNS_HEADING = "Forward uncertainty unavailable";
const NO_SCENARIO_RETURNS_BODY =
  "This scenario has no projected return history yet, so there's nothing to simulate. Add strategies with enough history to the scenario first.";
const WORKER_ERROR_HEADING = "Couldn't run the simulation";
const WORKER_ERROR_BODY =
  "The forward simulation didn't complete. Try adjusting the scenario or reloading.";

interface MonteCarloSectionProps {
  /** The active scenario's already-leveraged daily portfolio returns (raw). */
  portfolioDaily: DailyPoint[];
  /**
   * The scenario N (the historical overlap) — `scenarioMetrics.n`. The floor
   * GATE runs on this prop; the rendered disclosure names `result.n` (the worker
   * series length). They are the SAME sample-size axis by the engine contract:
   * `computeScenario` sets `portfolio_daily_returns.length === n` on the ok path,
   * and emits `[]` only on a degenerate return (caught by the first render gate
   * `portfolioDaily.length === 0` before the floor gate). If a future engine
   * change ever made a non-empty series whose length ≠ n, the disclosed N could
   * drift from the gated N — keep that invariant intact.
   */
  n: number;
  /**
   * The active de-aliased strategy count. The floor gate (a pure check) cannot
   * see this; the call site supplies it so a 0/1-strategy set routes to the
   * "add at least 2 strategies" body instead of naming a meaningless overlap N.
   */
  strategyCount: number;
  /** Forward horizon in trading days (default 252). */
  horizonDays?: number;
  /** Bootstrap path count (default 1000). */
  paths?: number;
}

/**
 * A worker outcome tagged with the EXACT `portfolioDaily` reference it was
 * computed for. Render derives "computing" by comparing this `src` to the
 * current prop (`scenarioMetrics.portfolio_daily_returns` keeps a stable
 * reference until the scenario changes) — so a result for a superseded input is
 * never shown, and we never call setState synchronously inside the effect (only
 * in the async worker callbacks). `value` is the bands result or the "error"
 * sentinel.
 */
type RunOutcome = { src: DailyPoint[]; value: MonteCarloResult | "error" };

export function MonteCarloSection({
  portfolioDaily,
  n,
  strategyCount,
  horizonDays = MC_HORIZON_DEFAULT,
  paths = MC_PATHS_DEFAULT,
}: MonteCarloSectionProps) {
  const [run, setRun] = useState<RunOutcome | null>(null);

  useEffect(() => {
    // SYNCHRONOUS gates FIRST (#509) — never spawn a worker for bands we already
    // know we won't render. Eligibility mirrors the render gates below. No
    // setState here: the gate render branches don't read `run`, and the computing
    // state is DERIVED in render (no stale "idle"/"computing" to store).
    if (portfolioDaily.length === 0) return;
    if (!evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS).ok) return;

    // Eligible → debounce the spawn so a rapid weight-scrub doesn't launch a
    // worker per keystroke. setState happens ONLY in the async callbacks.
    let cancelled = false;
    let active: MonteCarloRun | null = null;
    const timer = setTimeout(() => {
      // A construction failure surfaces as a rejected promise (handled below);
      // the try/catch additionally guards any synchronous throw so the section
      // can never be pinned on the computing state.
      try {
        active = runMonteCarloOffThread({ portfolioDaily, horizonDays, paths });
      } catch {
        if (!cancelled) setRun({ src: portfolioDaily, value: "error" });
        return;
      }
      active.promise.then(
        (result) => {
          if (!cancelled) setRun({ src: portfolioDaily, value: result });
        },
        () => {
          if (!cancelled) setRun({ src: portfolioDaily, value: "error" });
        },
      );
    }, MC_DEBOUNCE_MS);

    // Teardown: cancel the pending spawn + terminate any in-flight worker, and
    // mark this run stale so a late post can never overwrite a newer run.
    return () => {
      cancelled = true;
      clearTimeout(timer);
      active?.cancel();
    };
  }, [portfolioDaily, n, horizonDays, paths]);

  // ── Render: SAME guard order as the effect (#509; body names the TRUE cause) ──
  // 1. scenario-side absence FIRST.
  if (portfolioDaily.length === 0) {
    return <EmptyStateCard heading={NO_SCENARIO_RETURNS_HEADING} body={NO_SCENARIO_RETURNS_BODY} />;
  }
  // 2. below the Phase-22 sample floor — the imported SoT, never a literal 60.
  const verdict = evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS);
  if (!verdict.ok) {
    return <SampleFloorEmptyState verdict={verdict} feature="Monte-Carlo" strategyCount={strategyCount} />;
  }
  // DERIVED freshness: a stored outcome counts only if it was computed for the
  // CURRENT portfolioDaily reference; otherwise we're still computing the new one.
  const fresh = run && run.src === portfolioDaily ? run.value : null;
  // 3. no fresh result yet (initial mount, debounce window, or inputs changed) → computing.
  if (fresh === null) {
    return (
      <div data-testid="mc-computing">
        <Skeleton className="h-[240px] w-full" />
        <p className="mt-2 text-[11px] text-text-muted">Simulating forward paths…</p>
      </div>
    );
  }
  // 4. worker errored, or returned an un-usable envelope (e.g. a non-finite series
  //    the sync gates can't see) → honest "couldn't compute", never a fake band.
  if (fresh === "error" || !fresh.ok || !fresh.bands || !fresh.terminal) {
    return <EmptyStateCard heading={WORKER_ERROR_HEADING} body={WORKER_ERROR_BODY} />;
  }

  // 5. ok → the band chart + terminal summary + the mandatory disclosure line.
  // Destructure the guard-narrowed values (bands + terminal are non-null here).
  const { bands, terminal, paths: pathCount, blockLength, horizonDays: hzn, n: overlapN } = fresh;
  // Honest-to-N copy: when N is within ~1.5× the floor (a short common history),
  // make the wide-interval cause explicit rather than letting it read as noise.
  const shortHistory = overlapN !== null && overlapN < SAMPLE_FLOOR_OVERLAPPING_DAYS * 1.5;

  return (
    <div>
      <h3 className="text-base font-semibold text-text-primary">
        Forward uncertainty over the next {hzn} trading days
      </h3>
      <div className="mt-3">
        <MonteCarloBandChart bands={bands} />
      </div>
      <div
        data-testid="mc-terminal"
        className="mt-3 flex items-center justify-between border-b border-border/50 py-2"
      >
        <span className="text-xs text-text-muted">Median terminal return · 5–95% interval</span>
        <span className="text-xs font-metric text-text-secondary">
          {formatPercent(terminal.median)} · {formatPercent(terminal.lo)} to {formatPercent(terminal.hi)}
        </span>
      </div>
      {/* Disclosure — never a bare band. Single-sourced via methodologyLine,
          extended with the path count + block length + the no-Normal framing. */}
      <p className="mt-2 text-[11px] text-text-muted" data-testid="mc-disclosure">
        Block bootstrap of realized daily returns · {pathCount} paths · block{" "}
        {blockLength}d · {methodologyLine(overlapN ?? 0)} Not a Normal model.
      </p>
      {shortHistory && (
        <p className="mt-1 text-[11px] text-text-muted" data-testid="mc-short-history">
          This interval is wide because the strategies share only {overlapN} overlapping days — more
          common history would tighten it.
        </p>
      )}
    </div>
  );
}
