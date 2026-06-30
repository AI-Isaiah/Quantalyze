"use client";

import { formatPercent, formatNumber } from "@/lib/utils";
import { methodologyLine } from "@/lib/scenario-history";
import { evaluateSampleFloor } from "@/lib/sample-floor";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import {
  computeScenarioBenchmark,
  innerJoinByDate,
} from "../lib/scenario-benchmark";
import type { DailyPoint } from "@/lib/scenario";

/**
 * Plan 24-03 (BENCH-01) — the user-visible "vs BTC" active-return section,
 * extracted OUT of the large ScenarioComposer so its honesty invariants are
 * unit-testable in isolation (ScenarioBenchmarkSection.test.tsx).
 *
 * Purely presentational over props: the composer fetches the BTC daily-returns
 * series and supplies it; this component inner-joins it with the active
 * scenario's `portfolio_daily_returns` by date (the INTERSECTION window),
 * gates render on the 30-day benchmark floor, and either renders the four
 * 252-day annualized active-return metrics OR an honest "Benchmark comparison
 * unavailable" empty state.
 *
 * Honesty invariants (test-pinned):
 *   - {N} in the heading is the ALIGNED intersection count, never the union.
 *   - THREE DISTINCT empty-state bodies (#509): the SCENARIO itself produced no
 *     returns (degenerate active set) vs a no-overlap / not-covered benchmark
 *     window (incl. a failed/empty fetch) vs an overlap below the 30-day floor.
 *     The heading is constant; the body names the SPECIFIC, TRUE reason — a
 *     degenerate scenario must NOT be misattributed to benchmark coverage.
 *   - Every metric value flows through `formatPercent`/`formatNumber`, so a
 *     null/non-finite metric renders the em-dash "—" — never a fabricated 0.
 *   - The empty state is the neutral `EmptyStateCard` (no alert role, no
 *     red/amber): insufficient/missing benchmark coverage is honest absence,
 *     not an error.
 *
 * Two derived shapes from one daily-returns source: this section consumes the
 * RAW daily returns (for the metrics); the chart overlay (wired in the composer)
 * consumes the CUMULATIVE-WEALTH form. See 24-RESEARCH Pitfall 3.
 */

// Empty-state copy (UI-SPEC §Copywriting — verbatim; heading MUST match body).
const EMPTY_HEADING = "Benchmark comparison unavailable";
// The scenario itself produced no daily returns (no active strategies / a
// degenerate active set). The cause is scenario-side, NOT benchmark coverage —
// blaming BTC here would be a heading-matches-body lie (#509).
const NO_SCENARIO_RETURNS_BODY =
  "This scenario has no projected return history yet, so there's nothing to compare against BTC. Add strategies with enough history to the scenario first.";
const NO_OVERLAP_BODY =
  "The BTC benchmark series doesn't cover this scenario's date window, so there's nothing to compare against. Pick strategies whose history overlaps the benchmark.";
function belowFloorBody(n: number): string {
  return (
    `These dates share ${n} overlapping days with the BTC benchmark — ` +
    "fewer than the 30 needed for an honest comparison. " +
    "Pick strategies with longer common history."
  );
}

const BENCHMARK_FLOOR = 30;

interface ScenarioBenchmarkSectionProps {
  /** The active scenario's full-resolution daily portfolio returns (raw). */
  portfolioDaily: DailyPoint[];
  /** BTC daily-returns series fetched from `/api/benchmark/btc` (raw). */
  btcDaily: DailyPoint[];
  /**
   * False when the `/api/benchmark/btc` fetch failed or returned empty — the
   * section degrades to the honest no-overlap empty state, never an error.
   */
  benchmarkAvailable: boolean;
}

/** One label/value metric row mirroring the ScenarioCompareTable row tokens. */
function MetricRow({
  metric,
  label,
  value,
}: {
  metric: string;
  label: string;
  value: string;
}) {
  return (
    <div
      data-testid={`benchmark-row-${metric}`}
      className="flex items-center justify-between border-b border-border/50 py-2"
    >
      <span className="text-xs text-text-muted">{label}</span>
      <span
        data-testid={`benchmark-value-${metric}`}
        className="text-xs font-metric text-text-secondary"
      >
        {value}
      </span>
    </div>
  );
}

export function ScenarioBenchmarkSection({
  portfolioDaily,
  btcDaily,
  benchmarkAvailable,
}: ScenarioBenchmarkSectionProps) {
  // Inner-join FIRST so {N} is the intersection count, not the union window.
  const { p } = innerJoinByDate(portfolioDaily, btcDaily);
  const n = p.length;
  const verdict = evaluateSampleFloor(n, BENCHMARK_FLOOR);

  // Empty-state routing (order matters — #509; the body must name the TRUE
  // cause, checked most-specific first):
  //   0. the SCENARIO produced no returns (degenerate active set) → the
  //      scenario-side body. Checked FIRST so a degenerate scenario is never
  //      misattributed to benchmark coverage (n is 0 here for that reason, not
  //      because BTC fails to overlap a real window).
  //   1. fetch failed/empty OR zero overlap on a real scenario window → the
  //      benchmark doesn't cover it → the NO-OVERLAP body.
  //   2. a real but below-floor overlap → the BELOW-FLOOR body naming {n}.
  if (portfolioDaily.length === 0) {
    return (
      <EmptyStateCard heading={EMPTY_HEADING} body={NO_SCENARIO_RETURNS_BODY} />
    );
  }
  if (!benchmarkAvailable || n === 0) {
    return <EmptyStateCard heading={EMPTY_HEADING} body={NO_OVERLAP_BODY} />;
  }
  if (!verdict.ok) {
    return (
      <EmptyStateCard heading={EMPTY_HEADING} body={belowFloorBody(n)} />
    );
  }

  // Metrics path. Each value flows through a formatter so null → "—".
  const m = computeScenarioBenchmark(portfolioDaily, btcDaily);

  return (
    <div>
      <h3 className="text-base font-semibold text-text-primary">
        vs BTC over {m.n} overlapping days
      </h3>
      <div className="mt-3">
        {/* TE / Alpha are active RETURNS → percent; IR / Beta are ratios → number. */}
        <MetricRow
          metric="tracking-error"
          label="Tracking Error"
          value={formatPercent(m.trackingError)}
        />
        <MetricRow
          metric="information-ratio"
          label="Information Ratio"
          value={formatNumber(m.informationRatio)}
        />
        <MetricRow
          metric="alpha"
          label="Alpha"
          value={formatPercent(m.alpha)}
        />
        <MetricRow metric="beta" label="Beta" value={formatNumber(m.beta)} />
      </div>
      <p className="mt-2 text-fixed-11 text-text-muted">
        {methodologyLine(m.n)} Metrics are 252-day annualized active returns.
      </p>
    </div>
  );
}
