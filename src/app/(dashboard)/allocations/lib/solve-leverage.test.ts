/**
 * Phase 113 · Plan 00 (Wave 0 RED scaffold) — WEIGHTS-03/04 max-DD → L solver.
 *
 * Every solve-asserting test below FAILS on the current tree because
 * `solveLeverageForMaxDD` is the Wave-0 stub returning
 * `{ ok: false, reason: "unimplemented" }`. The failures are ASSERTION
 * mismatches (a wrong `ok` / `reason` / `leverage`), never a crash or an import
 * error — exactly the 112-00 regression-first discipline. Plans 113-01 / 113-02
 * flip them green.
 *
 * ⭐ FOUNDER LOCK (2026-07-17): the target is the SLEEVE's OWN standalone levered
 * max-DD, sourced from `computeScenario` on a single weight-1 constituent
 * (`portDaily = L·rᵢ`). Monotone in L → unique root. The pinned fixtures below
 * were confirmed against the REAL frozen engine (see the inline `|dd(L)|`
 * identities): 5% → 20% → L = 4.000 is the founder's acceptance value.
 *
 * The round-trip (g) is NON-TAUTOLOGICAL: it derives the target FROM the engine,
 * solves, then re-feeds the solved L through `computeScenario` (not the solver's
 * own math) and additionally proves a perturbed L breaks the match.
 */

import { describe, it, expect } from "vitest";
import {
  solveLeverageForMaxDD,
  DD_TOL,
  L_TOL,
  type SolveLeverageResult,
} from "./solve-leverage";
import {
  buildDateMapCache,
  computeScenario,
  type StrategyForBuilder,
  type ScenarioState,
} from "@/lib/scenario";
import { MAX_LEVERAGE } from "@/lib/leverage";

// --- Deterministic fixtures ------------------------------------------------

const REF = "sleeve-1";

/** Build a single-constituent StrategyForBuilder from a returns array over
 *  consecutive ISO dates (April 2026). No production logic — a pure fixture. */
function makeStrategy(values: number[], id = REF): StrategyForBuilder {
  const daily_returns = values.map((value, i) => ({
    date: `2026-04-${String(i + 1).padStart(2, "0")}`,
    value,
  }));
  return {
    id,
    name: id,
    codename: null,
    disclosure_tier: "public",
    strategy_types: [],
    markets: [],
    start_date: daily_returns[0]?.date ?? null,
    daily_returns,
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  };
}

/** The single-constituent SLEEVE state at leverage L — weight 1, selected, so
 *  the engine reduces the blend to `portDaily = L·r`. State-object literal only. */
function sleeveStateAt(L: number, id = REF): ScenarioState {
  return {
    selected: { [id]: true },
    weights: { [id]: 1 },
    startDates: {},
    leverage: { [id]: L },
  };
}

/** Assemble the solver args for a one-constituent sleeve at `targetMaxDD`. */
function solveArgs(
  strat: StrategyForBuilder,
  targetMaxDD: number,
  extra: Partial<Parameters<typeof solveLeverageForMaxDD>[0]> = {},
): Parameters<typeof solveLeverageForMaxDD>[0] {
  return {
    strategies: [strat],
    engineState: sleeveStateAt(1, strat.id),
    dateMapCache: buildDateMapCache([strat]),
    periodsPerYear: 252,
    ref: strat.id,
    targetMaxDD,
    ...extra,
  };
}

/** Narrow a result to the ok:true branch for value assertions. The leading
 *  `expect(result.ok).toBe(true)` carries the RED — this cast never masks it. */
function asOk(r: SolveLeverageResult): Extract<SolveLeverageResult, { ok: true }> {
  return r as Extract<SolveLeverageResult, { ok: true }>;
}
/** Narrow a result to the ok:false branch for reason/ceiling assertions. */
function asErr(
  r: SolveLeverageResult,
): Extract<SolveLeverageResult, { ok: false }> {
  return r as Extract<SolveLeverageResult, { ok: false }>;
}

const zeros = (n: number) => Array.from({ length: n }, () => 0);

describe("solveLeverageForMaxDD — Phase 113 Wave-0 RED scaffold", () => {
  // (a) FOUNDER — one −0.05 day among eleven 0 days → sleeve |dd(L)| = 0.05·L.
  // Confirmed vs the real engine: dd(1) = −0.05, dd(4) = −0.20. Target 0.20 → the
  // founder's 5% → 20% → 4× acceptance value.
  it("(a) FOUNDER — 5% unlevered sleeve max-DD, target 20% → L = 4.000", () => {
    const s = makeStrategy([0, 0, 0, 0, 0, -0.05, 0, 0, 0, 0, 0, 0]);
    const result = solveLeverageForMaxDD(solveArgs(s, 0.2));
    expect(result.ok).toBe(true);
    const ok = asOk(result);
    expect(Math.abs(ok.leverage - 4.0)).toBeLessThanOrEqual(L_TOL);
    // The reported sleeve max-DD is the engine's negative fraction near −0.20.
    expect(Math.abs(Math.abs(ok.sleeveMaxDD) - 0.2)).toBeLessThanOrEqual(DD_TOL);
  });

  // (b) COMPOUNDING — [−0.03, −0.03] consecutive among zeros → the drawdown
  // compounds: |dd(L)| = 1 − (1 − 0.03·L)² (NON-linear in L). Confirmed vs the
  // engine: dd(1) = −0.0591 (base), dd(2.6015) = −0.15. Target 0.15 → L ≈ 2.6015.
  // The retired closed-form target/base = 0.15/0.0591 ≈ 2.538 is measurably WRONG
  // (> L_TOL away) — this proves the solve is numerical, not linear.
  it("(b) COMPOUNDING — target 15% → L ≈ 2.6015, and NOT the retired 0.15/0.0591 closed-form", () => {
    const s = makeStrategy([0, 0, 0, -0.03, -0.03, 0, 0, 0, 0, 0, 0, 0]);
    const result = solveLeverageForMaxDD(solveArgs(s, 0.15));
    expect(result.ok).toBe(true);
    const ok = asOk(result);
    expect(Math.abs(ok.leverage - 2.6015)).toBeLessThanOrEqual(L_TOL);
    // The linear closed-form (target ÷ base max-DD) lands at ~2.538 — the solver
    // must be measurably away from it (compounding, not scaling).
    const retiredClosedForm = 0.15 / 0.0591;
    expect(Math.abs(ok.leverage - retiredClosedForm)).toBeGreaterThan(L_TOL);
  });

  // (c) DELEVERAGE — one −0.10 day → |dd(L)| = 0.10·L. Confirmed: dd(0.5) = −0.05.
  // A below-base target (0.05 < the 0.10 unlevered max-DD) is reachable only by
  // DELEVERAGING (L < 1) — the founder domain is [0, min(MAX_LEVERAGE, L_ruin)].
  it("(c) DELEVERAGE — below-base target 5% → L = 0.500 (L<1 allowed)", () => {
    const s = makeStrategy([0, 0, 0, 0, -0.1, 0, 0, 0, 0, 0, 0, 0]);
    const result = solveLeverageForMaxDD(solveArgs(s, 0.05));
    expect(result.ok).toBe(true);
    const ok = asOk(result);
    expect(Math.abs(ok.leverage - 0.5)).toBeLessThanOrEqual(L_TOL);
  });

  // (d) RUIN-CLAMP — one −0.30 day → L_ruin = 1/0.30 ≈ 3.333 < MAX_LEVERAGE(10).
  // Confirmed: dd(1.6667) = −0.50001, dd(3.4) = null (ruined). Target 0.50 → the
  // solver terminates at L ≈ 1.6667. A naive [0, MAX_LEVERAGE] bisect would sample
  // null-dd trials above 3.33; the ruin-clamped domain must not.
  it("(d) RUIN-CLAMP — target 50% on a −30% day → L ≈ 1.6667 (never scans past L_ruin≈3.33)", () => {
    const s = makeStrategy([0, 0, 0, 0, -0.3, 0, 0, 0, 0, 0, 0, 0]);
    const result = solveLeverageForMaxDD(solveArgs(s, 0.5));
    expect(result.ok).toBe(true);
    const ok = asOk(result);
    expect(Math.abs(ok.leverage - 1.6667)).toBeLessThanOrEqual(L_TOL);
    expect(ok.leverage).toBeLessThan(1 / 0.3); // below the ruin ceiling
  });

  // (e) UNREACHABLE with reported ceiling — the founder fixture with an explicit
  // maxLeverage: 2.5 ceiling caps the sleeve max-DD at 0.05·2.5 = 0.125 < 0.20.
  // The honest result is { ok:false, reason:"unreachable", ceiling:2.5 } with NO
  // leverage. RED-proof: a clamp-and-lie stub returning MAX_LEVERAGE fails this.
  it("(e) UNREACHABLE — target 20% with maxLeverage 2.5 → { reason:'unreachable', ceiling:2.5 }, no leverage", () => {
    const s = makeStrategy([0, 0, 0, 0, 0, -0.05, 0, 0, 0, 0, 0, 0]);
    const result = solveLeverageForMaxDD(solveArgs(s, 0.2, { maxLeverage: 2.5 }));
    expect(result.ok).toBe(false);
    const err = asErr(result);
    expect(err.reason).toBe("unreachable");
    expect(err.ceiling).toBe(2.5);
    // Never a fabricated leverage on the infeasible branch.
    expect(result).not.toHaveProperty("leverage");
  });

  // (f) DEGENERATE trio — each honest reason is a DISTINCT string; the blanket
  // "unimplemented" stub mismatches all three → RED. Values confirmed vs the
  // engine: flat dd = 0 ∀L; a 5-obs series → null (n<10); a −1.5 day → null (ruin
  // at 1×).
  it("(f) DEGENERATE — flat → 'no-drawdown'; 5 obs → 'insufficient-history'; −150% day → 'degenerate'", () => {
    const flat = makeStrategy(zeros(12));
    expect(asErr(solveLeverageForMaxDD(solveArgs(flat, 0.1))).reason).toBe(
      "no-drawdown",
    );

    const short = makeStrategy([0, -0.02, 0, 0.01, 0]);
    expect(asErr(solveLeverageForMaxDD(solveArgs(short, 0.1))).reason).toBe(
      "insufficient-history",
    );

    const catastrophic = makeStrategy([0, 0, -1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(
      asErr(solveLeverageForMaxDD(solveArgs(catastrophic, 0.1))).reason,
    ).toBe("degenerate");
  });

  // (g) ROUND-TRIP (WEIGHTS-04, non-tautological) — derive the target FROM the
  // engine at L*=2.5 on the compounding fixture, solve, then re-feed the solved L
  // through computeScenario (NOT the solver). Both the L match AND the engine
  // re-derivation must hold. PERTURBATION teeth: a +0.15 nudge to the solved L
  // must move the engine's max-DD OFF the target by more than DD_TOL — the round
  // trip is only meaningful if perturbing L breaks it (the Nyquist non-tautology).
  it("(g) ROUND-TRIP — solved L re-fed through the engine reproduces the target; a perturbed L does not", () => {
    const s = makeStrategy([0, 0, 0, -0.03, -0.03, 0, 0, 0, 0, 0, 0, 0]);
    const cache = buildDateMapCache([s]);
    const target = Math.abs(
      computeScenario([s], sleeveStateAt(2.5), cache, 252).max_drawdown!,
    );

    const result = solveLeverageForMaxDD(solveArgs(s, target));
    expect(result.ok).toBe(true);
    const solvedL = asOk(result).leverage;

    // (i) the solver found the leverage.
    expect(Math.abs(solvedL - 2.5)).toBeLessThanOrEqual(L_TOL);

    // (ii) re-fed through the ENGINE (not the solver) → reproduces the target.
    const reFed = Math.abs(
      computeScenario([s], sleeveStateAt(solvedL), cache, 252).max_drawdown!,
    );
    expect(Math.abs(reFed - target)).toBeLessThanOrEqual(DD_TOL);

    // (iii) PERTURBATION — nudging L by +0.15 breaks the reproduction (proves the
    // round-trip is not a tautology that passes for any L).
    const perturbed = Math.abs(
      computeScenario([s], sleeveStateAt(solvedL + 0.15), cache, 252)
        .max_drawdown!,
    );
    expect(Math.abs(perturbed - target)).toBeGreaterThan(DD_TOL);
  });

  // (g2) ROUND-TRIP DELEVERAGE (WEIGHTS-04, both sides of 1×) — the same
  // non-tautological forward-then-back contract at a DELEVERAGE root L* = 0.6 on
  // the −0.10-day fixture (|dd(L)| = 0.10·L, so dd(0.6) = −0.06 < the 0.10 base).
  // Proves the tolerance contract holds below 1×, not just when levering up.
  // Perturbation arithmetic: +0.15 nudges L 0.6→0.75, |dd| 0.06→0.075 — a 0.015
  // move, ~15× DD_TOL, so the teeth bite on the deleverage side too.
  it("(g2) ROUND-TRIP DELEVERAGE — solved L≈0.6 re-fed through the engine reproduces the target; a perturbed L does not", () => {
    const s = makeStrategy([0, 0, 0, 0, -0.1, 0, 0, 0, 0, 0, 0, 0]);
    const cache = buildDateMapCache([s]);
    const target = Math.abs(
      computeScenario([s], sleeveStateAt(0.6), cache, 252).max_drawdown!,
    );

    const result = solveLeverageForMaxDD(solveArgs(s, target));
    expect(result.ok).toBe(true);
    const solvedL = asOk(result).leverage;

    // (i) the solver found the deleverage root (L < 1).
    expect(Math.abs(solvedL - 0.6)).toBeLessThanOrEqual(L_TOL);
    expect(solvedL).toBeLessThan(1);

    // (ii) re-fed through the ENGINE (not the solver) → reproduces the target.
    const reFed = Math.abs(
      computeScenario([s], sleeveStateAt(solvedL), cache, 252).max_drawdown!,
    );
    expect(Math.abs(reFed - target)).toBeLessThanOrEqual(DD_TOL);

    // (iii) PERTURBATION — nudging L by +0.15 breaks the reproduction on the
    // deleverage side too (non-tautology proven below 1×).
    const perturbed = Math.abs(
      computeScenario([s], sleeveStateAt(solvedL + 0.15), cache, 252)
        .max_drawdown!,
    );
    expect(Math.abs(perturbed - target)).toBeGreaterThan(DD_TOL);
  });
});
