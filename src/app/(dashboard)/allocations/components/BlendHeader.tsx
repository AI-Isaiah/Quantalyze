import type { ComputedMetrics } from "@/lib/scenario";
import type { CoverageWindow } from "@/lib/scenario-window";

/**
 * BlendHeader (COVERAGE-03) — the phase's PRIMARY visual anchor.
 *
 * Presentation-only. Reads the engine's honest membership axis
 * (`member_count` / `effective_start` / `effective_end`) and states the blend
 * plainly. It NEVER counts the coverage-eligible axis or re-derives membership —
 * the divisor is `member_count` by construction (BLEND-06); recounting would
 * risk a divisor desync (Pitfall 1), which the coverageEligible↔member_ids
 * dev cross-check in ScenarioComposer exists to catch.
 *
 * Honest degrade order (LOCKED, 58-UI-SPEC §Copywriting Contract — verbatim):
 *   N === 0 → "No strategies span the selected window"
 *   N === 1 → "1 strategy — not a blend"
 *   else    → "Mean of {N} strategies · {effStart}–{effEnd}"
 *             (+ " · window truncated from full range" when the effective window
 *              is narrower than the union of the selected set)
 *
 * Non-blocking live region: this is a polite status region, never an assertive
 * one. Numbers + dates render in Geist Mono (`font-mono tabular-nums`) per
 * DESIGN.md "all numbers use Geist Mono".
 */
export interface BlendHeaderProps {
  /** Engine output — the sole source of the member count + effective window. */
  metrics: ComputedMetrics;
  /**
   * Union of the selected set's coverage spans (`fullRangeWindow` in the
   * composer). Drives the "truncated from full range" note; may be null when
   * no strategy is selected.
   */
  unionSpan: CoverageWindow | null;
}

export function BlendHeader({ metrics, unionSpan }: BlendHeaderProps) {
  const n = metrics.member_count ?? 0;
  const effStart = metrics.effective_start;
  const effEnd = metrics.effective_end;

  // Lexicographic "YYYY-MM-DD" compare (never JS Date): the effective window is
  // truncated when it is narrower than the selected-set union on either bound.
  const truncated =
    unionSpan != null &&
    effStart != null &&
    effEnd != null &&
    (effStart > unionSpan.start || effEnd < unionSpan.end);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="scenario-blend-header"
      className="text-fixed-13 font-medium text-text-secondary"
    >
      {n === 0 ? (
        "No strategies span the selected window"
      ) : n === 1 ? (
        // N=1 degrade note is the quieter regular tier (58-UI-SPEC §Typography);
        // rendered as one text node so the verbatim copy stays a single string.
        <span className="text-fixed-11 font-normal text-text-muted">
          1 strategy — not a blend
        </span>
      ) : (
        <span>
          Mean of{" "}
          <span className="font-mono tabular-nums">{n}</span> strategies ·{" "}
          <span className="font-mono tabular-nums">{effStart}</span>
          {"–"}
          <span className="font-mono tabular-nums">{effEnd}</span>
          {truncated ? (
            <span className="text-fixed-11 font-normal text-text-muted">
              {" · window truncated from full range"}
            </span>
          ) : null}
        </span>
      )}
    </div>
  );
}
