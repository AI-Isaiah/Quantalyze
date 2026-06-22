"use client";

import { useMemo, useState } from "react";
import { formatPercent } from "@/lib/utils";
import { methodologyLine } from "@/lib/scenario-history";
import {
  evaluateSampleFloor,
  SAMPLE_FLOOR_OVERLAPPING_DAYS,
} from "@/lib/sample-floor";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { SampleFloorEmptyState } from "@/components/scenarios/SampleFloorEmptyState";
import { SegmentedControl } from "@/components/strategy-v2/SegmentedControl";
import {
  computeScenarioStress,
  VAR_CONFIDENCE_LABEL,
} from "../lib/scenario-stress";
import type { DailyPoint } from "@/lib/scenario";

/**
 * Plan 26-02 (STRESS-01 + STRESS-02) — the user-visible "Stress & VaR" section,
 * mounted in the own-book ScenarioComposer immediately after the
 * ScenarioBenchmarkSection. The verbatim sibling of that section: purely
 * presentational over props, with the same MetricRow tokens, the same
 * guard-order routing, the same methodology-caption discipline, and the same
 * em-dash-on-null formatter wrap. The math is wholly delegated to the golden,
 * null-safe `computeScenarioStress` (Plan 26-01) — this component owns NONE of
 * the arithmetic, only the UI contract (26-UI-SPEC.md).
 *
 * It lets an allocator pick a BTC shock preset (−10 / −20 / −30%, −30% default)
 * and read the β-propagated projected portfolio impact (STRESS-01) plus the
 * historical VaR(95%) + CVaR / Expected Shortfall with a mandatory inline
 * disclosure line (STRESS-02) — never a bare VaR.
 *
 * Honesty invariants (test-pinned in StressVarSection.test.tsx):
 *   - Losses are MONOCHROME honest data (`text-text-secondary`, Geist Mono), the
 *     explicit divergence from the anti-pattern `VarExpectedShortfall.tsx`. A
 *     loss is never painted with a destructive/error color; the negative sign
 *     and percent format carry the meaning.
 *   - Every value flows through `formatPercent`, so a null / non-finite metric
 *     renders the em-dash "—" — NEVER a fabricated `0.00`.
 *   - Fixed guard order (#509): scenario-side absence → BTC unavailable → below
 *     the Phase-22 sample floor → ok. Each empty-state heading matches its body;
 *     a degenerate scenario is never misattributed to BTC.
 *   - The sample floor is the imported `SAMPLE_FLOOR_OVERLAPPING_DAYS` SoT,
 *     NEVER a re-declared literal 60.
 *   - The disclosure is single-sourced via `methodologyLine`. The VaR/CVaR
 *     caption names the scenario N (`varN`); the β-shock caption names the BTC
 *     inner-join N (`betaN`). When the two Ns differ, TWO captions render — each
 *     number names its own true N (the two-N trap).
 */

// Empty-state copy (UI-SPEC §Copywriting — verbatim; heading MUST match body, #509).
// State 1: the SCENARIO produced no daily returns (degenerate active set). The
// cause is scenario-side, NOT BTC coverage — blaming BTC here would be a
// heading-matches-body lie.
const NO_SCENARIO_RETURNS_HEADING = "Stress & VaR unavailable";
const NO_SCENARIO_RETURNS_BODY =
  "This scenario has no projected return history yet, so there's nothing to stress or measure. Add strategies with enough history to the scenario first.";
// State 2: the BTC factor series fetch failed / returned empty.
const BTC_UNAVAILABLE_HEADING = "Stress testing unavailable";
const BTC_UNAVAILABLE_BODY =
  "The BTC factor series isn't available right now, so we can't project a market shock. Try again shortly.";

// The shock-preset affordance (UI-SPEC §Affordance — locked SegmentedControl).
// A closed preset domain (no free-text magnitude) keeps the shock honest and
// discrete. −30% is the default-active headline.
const SHOCK_OPTIONS = [
  { id: "-0.10", label: "−10%" },
  { id: "-0.20", label: "−20%" },
  { id: "-0.30", label: "−30%" },
] as const;
const DEFAULT_SHOCK_ID = "-0.30";

interface StressVarSectionProps {
  /** The active scenario's already-leveraged daily portfolio returns (raw). */
  portfolioDaily: DailyPoint[];
  /** BTC factor daily-returns series (the shock factor) fetched by the composer. */
  btcDaily: DailyPoint[];
  /**
   * False when the BTC fetch failed or returned empty — the section degrades to
   * the honest BTC-unavailable empty state, never an error.
   */
  btcAvailable: boolean;
  /** The scenario N (the VaR-window overlap) — `scenarioMetrics.n`. */
  n: number;
  /**
   * The active de-aliased strategy count. The floor gate (a pure check) cannot
   * see this; the call site supplies it so a 0/1-strategy set routes to the
   * "add at least 2 strategies" body instead of naming a meaningless overlap N.
   */
  strategyCount: number;
}

/**
 * One label/value metric row — copied verbatim from ScenarioBenchmarkSection's
 * MetricRow tokens. Numbers are MONOCHROME (`text-text-secondary`, Geist Mono),
 * never a destructive color — the explicit divergence from VarExpectedShortfall.
 */
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
      data-testid={`stress-row-${metric}`}
      className="flex items-center justify-between border-b border-border/50 py-2"
    >
      <span className="text-xs text-text-muted">{label}</span>
      <span
        data-testid={`stress-value-${metric}`}
        className="text-xs font-metric text-text-secondary"
      >
        {value}
      </span>
    </div>
  );
}

export function StressVarSection({
  portfolioDaily,
  btcDaily,
  btcAvailable,
  n,
  strategyCount,
}: StressVarSectionProps) {
  // The ONLY local state: the active shock preset. Its selection IS the
  // interaction — the projection recomputes from it (no submit CTA).
  const [shockId, setShockId] = useState<string>(DEFAULT_SHOCK_ID);

  // All math comes from the golden, null-safe `computeScenarioStress`. Recompute
  // on the active shock (and the inputs); the lib is pure so this is cheap.
  const result = useMemo(
    () =>
      computeScenarioStress(portfolioDaily, btcDaily, { shock: Number(shockId) }),
    [portfolioDaily, btcDaily, shockId],
  );

  // ── Empty-state routing (FIXED order — #509; the body names the TRUE cause) ──
  // 1. scenario-side absence FIRST (never misattribute to BTC).
  if (portfolioDaily.length === 0) {
    return (
      <EmptyStateCard
        heading={NO_SCENARIO_RETURNS_HEADING}
        body={NO_SCENARIO_RETURNS_BODY}
      />
    );
  }
  // 2. BTC unavailable (mirrors benchmarkAvailable=false).
  if (!btcAvailable) {
    return (
      <EmptyStateCard
        heading={BTC_UNAVAILABLE_HEADING}
        body={BTC_UNAVAILABLE_BODY}
      />
    );
  }
  // 3. below the Phase-22 sample floor — import the SoT constant, never a
  //    literal 60. The verdict guards no-usable-n FIRST then below-floor, and
  //    SampleFloorEmptyState renders its own SoT copy (never re-authored here).
  const verdict = evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS);
  if (!verdict.ok) {
    return (
      <SampleFloorEmptyState
        verdict={verdict}
        feature="VaR"
        strategyCount={strategyCount}
      />
    );
  }

  // ── ok ── SegmentedControl + headline impact + VaR/CVaR rows + disclosure(s).
  // The VaR window N (scenario) and the β-shock window N (BTC inner-join) can
  // differ; each number names its own true N (the two-N trap). Render two
  // captions when they differ, a single VaR/CVaR caption otherwise.
  const twoNs = result.varN !== result.betaN;
  // The β-shock impact is suppressed to "—" whenever the BTC inner-join is
  // degenerate (constant BTC) or too short (betaN < 2 ⇒ benchmark returns null).
  // The β/shock methodology caption must NOT affirm a methodology + N for a
  // value that did not, in fact, produce a usable number (#509: caption matches
  // data). Only render the β caption when the impact is actually shown.
  const impactShown = result.projectedImpact !== null;

  return (
    <div>
      <h3 className="text-base font-semibold text-text-primary">
        BTC shock &amp; downside risk over {result.varN} overlapping days
      </h3>
      <div className="mt-3">
        <SegmentedControl
          options={[...SHOCK_OPTIONS]}
          activeId={shockId}
          onChange={setShockId}
          ariaLabel="BTC shock"
        />
      </div>
      <div className="mt-3">
        <MetricRow
          metric="projected-impact"
          label="Projected portfolio impact"
          value={formatPercent(result.projectedImpact)}
        />
        <MetricRow
          metric="var"
          label="Value at Risk (95%)"
          value={formatPercent(result.var)}
        />
        <MetricRow
          metric="cvar"
          label="Expected Shortfall (CVaR, 95%)"
          value={formatPercent(result.cvar)}
        />
      </div>
      {/* VaR/CVaR disclosure — names the scenario N (varN). Single-sourced via
          methodologyLine, extended with the confidence level derived from the
          SAME VAR_CONFIDENCE constant the lib computes the quantile at, so the
          displayed "%" can never drift from the actual computation (WR-02).
          Never a bare VaR. */}
      <p className="mt-2 text-[11px] text-text-muted">
        {methodologyLine(result.varN)} {VAR_CONFIDENCE_LABEL} confidence.
      </p>
      {/* β-shock disclosure — names the BTC inner-join N (betaN) + the shock
          assumptions. Rendered only when the impact value is actually SHOWN
          (#509: a "—" impact never carries an affirmative β methodology claim).
          When shown, it is its OWN caption only if the two Ns differ, so each
          number names its true N. When the impact is suppressed, swap in an
          honest note that the BTC overlap was insufficient. */}
      {impactShown ? (
        twoNs ? (
          <p className="mt-1 text-[11px] text-text-muted">
            {methodologyLine(result.betaN)} Single-factor (BTC), linear β
            propagation, point-in-time.
          </p>
        ) : (
          <p className="mt-1 text-[11px] text-text-muted">
            Single-factor (BTC), linear β propagation over {result.betaN}{" "}
            overlapping days, point-in-time — not a forecast.
          </p>
        )
      ) : (
        <p className="mt-1 text-[11px] text-text-muted">
          BTC overlap too short to project a shock.
        </p>
      )}
    </div>
  );
}
