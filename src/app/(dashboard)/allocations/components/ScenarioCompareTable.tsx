"use client";

import { ResponsiveTable } from "@/components/ResponsiveTable";
import { formatPercent, formatNumber, cn } from "@/lib/utils";
import type { ComputedMetrics } from "@/lib/scenario";
import { methodologyLine } from "@/lib/scenario-history";
import {
  evaluateSampleFloor,
  sampleFloorBody,
  SAMPLE_FLOOR_HEADING,
} from "@/lib/sample-floor";

/**
 * Plan 23-03 (PERSIST-04) — the compare grid. Mirrors
 * `src/components/strategy/CompareTable.tsx` EXACTLY for the table scaffold +
 * `findWinner` highlighting + `formatValue` em-dash, but reads keys from
 * `ComputedMetrics` (the scenario engine output) and carries ONE load-bearing
 * divergence: each column stamps its OWN `methodologyLine(n)` caption over its
 * OWN coverage window — heterogeneous windows are correct, there is NO single
 * shared-window header. v1.5 PERSIST-03 AUGMENTS that per-column stamp with the
 * column's effective `{start}–{end}` window (read from the engine output, never
 * re-derived) so heterogeneous windows are visible and honest per column.
 *
 * Honesty invariants (test-pinned in ScenarioCompareTable.test.tsx):
 *   - A null/degenerate metric renders "—" via formatPercent/formatNumber —
 *     never a fabricated 0 / "0.00%" / "N/A".
 *   - A whole below-floor column (n < SAMPLE_FLOOR_OVERLAPPING_DAYS) is gated
 *     to the neutral sample-floor copy (no red/amber, no role="alert").
 *   - Winner + the Sharpe-leader callout match CompareTable's findWinner
 *     behavior; Max Drawdown + Volatility use higherIsBetter=false.
 *
 * Reuses ONLY UI-SPEC tokens/copy — no new icons, no new tokens.
 */

export interface ScenarioColumn {
  name: string;
  metrics: ComputedMetrics;
  /**
   * True when this column's saved draft was UNDECODABLE (codec "reset" — an
   * older/incompatible format), as opposed to a decodable-but-degenerate draft.
   * Both flow through as NULL metrics with n=0, but the footer stamp must
   * DISTINGUISH them: an undecodable column renders the "older format" stamp
   * (the column can't be compared because of its format), NOT the sample-floor
   * "shares 0 overlapping days — fewer than the 60 needed" copy (which conflates
   * "older format" with "insufficient history" — the #509 heading/body class).
   */
  undecodable?: boolean;
}

interface MetricRow {
  label: string;
  key: keyof ComputedMetrics;
  format: "percent" | "number";
  higherIsBetter: boolean;
}

/**
 * The six rows — a subset of CompareTable's METRICS, keyed on ComputedMetrics.
 *
 * `higherIsBetter` matches CompareTable's existing flags VERBATIM (the tested,
 * shipped analog at CompareTable.tsx:27-37):
 *   - Volatility → false (lower vol is better; vol is a positive magnitude).
 *   - Max Drawdown → TRUE. `computeScenario` stores max_drawdown as a NEGATIVE
 *     number (scenario.ts:333-344: maxDD starts at 0, takes the most-negative
 *     dd). A less-severe drawdown (-0.05) is numerically HIGHER than a worse one
 *     (-0.30), so `higherIsBetter: true` correctly crowns the least-severe
 *     drawdown. (The UI-SPEC's "false for Max Drawdown" was written for an
 *     unsigned-magnitude assumption; for the signed ComputedMetrics.max_drawdown
 *     it would crown the WORST drawdown — a winner-inversion bug. We follow the
 *     tested CompareTable flag, which is what "matches CompareTable's existing
 *     METRICS flags" in the plan resolves to.)
 */
const METRICS: MetricRow[] = [
  { label: "Cumulative Return", key: "twr", format: "percent", higherIsBetter: true },
  { label: "CAGR", key: "cagr", format: "percent", higherIsBetter: true },
  { label: "Sharpe", key: "sharpe", format: "number", higherIsBetter: true },
  { label: "Sortino", key: "sortino", format: "number", higherIsBetter: true },
  { label: "Max Drawdown", key: "max_drawdown", format: "percent", higherIsBetter: true },
  { label: "Volatility", key: "volatility", format: "percent", higherIsBetter: false },
];

/**
 * Read a single numeric metric off ComputedMetrics; null when absent/non-number
 * OR non-finite. A NaN/Infinity must be treated as honest absence at the SOURCE
 * (→ winner logic skips it, the cell renders "—") rather than relying on the
 * downstream formatPercent/formatNumber to coerce it — otherwise findWinner
 * could crown a NaN column as the "winner".
 */
function getValue(metrics: ComputedMetrics, key: keyof ComputedMetrics): number | null {
  const val = metrics[key];
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

/**
 * Footer stamp for an undecodable (codec "reset", older-format) column. DISTINCT
 * from the sample-floor copy: this column can't be compared because of its saved
 * FORMAT, not because of a short overlap window — naming "0 overlapping days"
 * here would be the #509 heading/body conflation.
 */
const OLDER_FORMAT_STAMP = "Saved in an older format — can't be compared";

/** Mirrors CompareTable.formatValue: null → "—" (em-dash honesty). */
function formatValue(value: number | null, format: MetricRow["format"]): string {
  if (value == null) return "—";
  if (format === "percent") return formatPercent(value);
  return formatNumber(value);
}

/**
 * Mirrors CompareTable.findWinner: skips null values, returns the best column
 * index (or null if no column has a value). higherIsBetter picks max, else min.
 */
function findWinner(
  columns: ScenarioColumn[],
  key: keyof ComputedMetrics,
  higherIsBetter: boolean,
): number | null {
  let bestIdx: number | null = null;
  let bestVal: number | null = null;
  columns.forEach((c, i) => {
    const val = getValue(c.metrics, key);
    if (val == null) return;
    if (bestVal == null || (higherIsBetter ? val > bestVal : val < bestVal)) {
      bestVal = val;
      bestIdx = i;
    }
  });
  return bestIdx;
}

/**
 * Count how many columns have a real (non-null finite) value for `key`.
 *
 * HONESTY tightening BEYOND the CompareTable analog: CompareTable marks a lone
 * real column as the winner, but a ✓ on a metric where only one column has a
 * value implies a comparison that didn't happen (the others are em-dashed). The
 * milestone forbids implying absent comparisons, so we suppress the ✓ (and the
 * accent) unless at least 2 columns are real for that metric.
 */
function realValueCount(
  columns: ScenarioColumn[],
  key: keyof ComputedMetrics,
): number {
  return columns.reduce(
    (n, c) => (getValue(c.metrics, key) != null ? n + 1 : n),
    0,
  );
}

export function ScenarioCompareTable({
  columns,
  liveBook,
}: {
  columns: ScenarioColumn[];
  liveBook: ScenarioColumn | null;
}) {
  // The live book participates as a column (its own window + winner candidacy).
  const allColumns: ScenarioColumn[] = liveBook ? [...columns, liveBook] : columns;

  // Under-selection: fewer than 2 columns to compare → UI-SPEC hint
  // (mirrors CompareTable's "Select strategies to compare." empty state).
  if (allColumns.length < 2) {
    return (
      <p className="text-sm text-text-muted text-center py-8">
        Select 2 or more scenarios (or the live book) to compare.
      </p>
    );
  }

  // Sharpe leader for the neutral callout (findWinner skips nulls). Suppress it
  // when fewer than 2 columns have a real Sharpe — a lone real Sharpe is not a
  // "leader" over an absent field (same honesty tightening as the per-metric ✓).
  const sharpeWinnerIdx = findWinner(allColumns, "sharpe", true);
  const sharpeLeaderName =
    sharpeWinnerIdx !== null && realValueCount(allColumns, "sharpe") >= 2
      ? allColumns[sharpeWinnerIdx].name
      : null;

  return (
    <div className="space-y-3">
      {/* Sharpe leader callout — neutral text; the winning cell carries the accent ✓. */}
      {sharpeLeaderName && (
        <p data-testid="sharpe-leader" className="text-xs text-text-secondary">
          Best Sharpe: {sharpeLeaderName}
        </p>
      )}

      <ResponsiveTable label="Scenario comparison">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-semibold text-text-muted w-40">
                Metric
              </th>
              {allColumns.map((c, i) => (
                <th
                  key={`${c.name}-${i}`}
                  data-testid={`scenario-col-${c.name}`}
                  className="text-right px-4 py-3 text-xs font-semibold text-text-primary"
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric) => {
              const winnerIdx = findWinner(allColumns, metric.key, metric.higherIsBetter);
              // Honesty tightening (beyond the CompareTable analog): only crown a
              // winner when >= 2 columns have a real value for this metric. A lone
              // real column (others em-dashed) gets NO ✓ — a ✓ would imply a
              // comparison that didn't happen.
              const hasComparison = realValueCount(allColumns, metric.key) >= 2;
              return (
                <tr key={metric.key} className="border-b border-border/50 hover:bg-page/50">
                  <td className="px-4 py-2.5 text-xs text-text-muted">{metric.label}</td>
                  {allColumns.map((c, i) => {
                    const val = getValue(c.metrics, metric.key);
                    const isWinner = winnerIdx === i && hasComparison;
                    return (
                      <td
                        key={`${c.name}-${i}`}
                        data-testid={`cell-${c.name}-${metric.key}`}
                        className="text-right px-4 py-2.5"
                      >
                        <span
                          data-testid={isWinner ? `winner-${metric.key}` : undefined}
                          className={cn(
                            "text-xs font-metric",
                            isWinner ? "text-accent font-bold" : "text-text-secondary",
                          )}
                        >
                          {formatValue(val, metric.format)}
                          {isWinner && " ✓"}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {/* Per-column honesty stamp — each column's OWN methodologyLine(n).
                Heterogeneous windows are expected and correct (Pitfall 5: NO
                single shared-window header). A whole below-floor column is gated
                to the neutral sample-floor copy instead of its window stamp. */}
            <tr>
              <td className="px-4 py-2 text-fixed-11 text-text-muted uppercase tracking-wider">
                Window
              </td>
              {allColumns.map((c, i) => {
                const verdict = evaluateSampleFloor(c.metrics.n);
                return (
                  <td
                    key={`${c.name}-stamp-${i}`}
                    data-testid={`stamp-${c.name}`}
                    className="text-right px-4 py-2 align-top"
                  >
                    {c.undecodable ? (
                      // Undecodable (older format) takes precedence over the
                      // sample-floor verdict: this column can't be compared
                      // because of its FORMAT, not a short overlap window.
                      <span className="block text-xs text-text-muted">
                        {OLDER_FORMAT_STAMP}
                      </span>
                    ) : verdict.ok ? (
                      // v1.5 PERSIST-03 — AUGMENT (do NOT replace) the day-count
                      // stamp with the column's OWN effective window, read from
                      // the engine output (NEVER re-derived). Each compared
                      // scenario computes at its own persisted draft.window, so
                      // heterogeneous windows read honestly per column. The dates
                      // mirror BlendHeader's treatment (font-mono tabular-nums,
                      // en-dash, lexicographic YYYY-MM-DD); the label stays the
                      // quiet text-text-muted honesty caption — never accent/
                      // warning/winner. Omitted when either bound is null
                      // (degenerate) — show just the day-count stamp.
                      <span className="text-xs font-metric text-text-muted">
                        {methodologyLine(c.metrics.n)}
                        {c.metrics.effective_start && c.metrics.effective_end ? (
                          <>
                            {" · "}
                            <span className="font-mono tabular-nums">
                              {c.metrics.effective_start}
                            </span>
                            {"–"}
                            <span className="font-mono tabular-nums">
                              {c.metrics.effective_end}
                            </span>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span className="block text-xs text-text-muted">
                        <span className="block font-medium">{SAMPLE_FLOOR_HEADING}</span>
                        <span className="block">
                          {sampleFloorBody(verdict, { feature: "comparison" })}
                        </span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </ResponsiveTable>
    </div>
  );
}
