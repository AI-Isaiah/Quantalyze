import { describe, it, expect } from "vitest";
import fixture from "./__fixtures__/blend07-six-series.json" with { type: "json" };
import {
  buildDateMapCache,
  computeScenario,
  type StrategyForBuilder,
  type ScenarioState,
} from "./scenario";
import { coverageSpanOf, defaultWindowFor } from "./scenario-window";

/**
 * BLEND-07 — the from-scratch numpy verification gate (Plan 55-03, ADR-001).
 *
 * This is the milestone's #1 correctness anchor. It asserts `computeScenario`
 * matches an INDEPENDENT from-scratch numpy re-derivation of the equal-weight
 * blend over the max-overlap (intersection) window, to floating-point precision,
 * with the divisor === the live-member count. It MUST be green BEFORE Phase 60
 * re-bakes any golden — a blind `--update-snapshots` that canonizes a Phase-55
 * math bug (PITFALLS Pitfall 8, the highest-risk pitfall) is defeated here by an
 * independent number the goldens do not derive from.
 *
 * PROVENANCE (fixture is DETERMINISTIC, no prod pull, hermetic in CI):
 *   The 6-series fixture `src/lib/__fixtures__/blend07-six-series.json` holds the
 *   raw date/daily_return series for the real strategy ids
 *   `mm / neon1 / pokeokx / uc244 + okx + bybit`. The real production series are
 *   not committed anywhere in-repo and pulling them live is non-deterministic
 *   (55-RESEARCH Assumption A2), so the fixture is a DETERMINISTIC REPRESENTATIVE
 *   dataset (fixed-seed synthesis, see `analytics-service/scripts/gen_blend07_fixture.py`)
 *   that reproduces the shape that matters: staggered inceptions, a longer UNION
 *   span, and one ENDED-tail member (`pokeokx`, last day 2025-12-31) so the
 *   max-overlap window is strictly tighter than the union — the whole point of
 *   BLEND-07 is proving the ended strategy no longer dilutes the divisor. The
 *   OLD-convention empirical numbers from the real 6-strategy prod audit
 *   (+586.86% / 51.82% / 2.43 / -15.15% / n=1163, ADR-001:21) are recorded for
 *   CONTRAST in `src/lib/__fixtures__/BLEND-07-verification.md`.
 *
 * FLOATING-POINT PRECISION (55-RESEARCH §BLEND-07 step 5):
 *   The engine payload is rounded (twr/cagr/vol/maxDD `.toFixed(5)`, sharpe
 *   `.toFixed(3)` — scenario.ts:617-622). We assert the rounded payload against the
 *   numpy value via `toBeCloseTo` at the payload's own decimal precision. The raw
 *   TS and numpy series agree to ~1e-10 before rounding; the committed artifact
 *   records the rounded numbers. These targets are the numpy oracle, NOT a
 *   re-derivation from the engine — regenerate ONLY by re-running
 *   `gen_blend07_fixture.py` and updating both this file and the artifact together.
 */

// ---------------------------------------------------------------------------
// The numpy oracle — the from-scratch numbers recorded in BLEND-07-verification.md.
// Regenerate via `analytics-service/.venv/bin/python analytics-service/scripts/gen_blend07_fixture.py`.
// ---------------------------------------------------------------------------
const NUMPY = {
  win_start: "2023-10-11",
  win_end: "2025-12-31",
  member_count: 6,
  member_ids: ["mm", "neon1", "pokeokx", "uc244", "okx", "bybit"],
  n: 581,
  twr: 1.1567855193398886,
  cagr: 0.3956732067196249,
  volatility: 0.11463143681939332,
  sharpe: 2.9673497576496706,
  max_drawdown: -0.06029498416617718,
} as const;

type FixtureSeries = Array<{ date: string; value: number }>;
type Fixture = Record<string, FixtureSeries>;

const fx = fixture as Fixture;
const STRATEGY_IDS = Object.keys(fx);

/** Build the 6 StrategyForBuilder objects from the committed fixture. */
function buildStrategies(): StrategyForBuilder[] {
  return STRATEGY_IDS.map((id) => ({
    id,
    name: id,
    codename: null,
    disclosure_tier: "institutional",
    strategy_types: ["arbitrage"],
    markets: ["BTC"],
    start_date: fx[id][0].date,
    daily_returns: fx[id],
    cagr: null,
    sharpe: null,
    volatility: null,
    max_drawdown: null,
  }));
}

/** Equal-weight ScenarioState with all 6 selected + the intersection window. */
function buildState(window: { start: string; end: string }): ScenarioState {
  const selected: Record<string, boolean> = {};
  const weights: Record<string, number> = {};
  const startDates: Record<string, string> = {};
  for (const id of STRATEGY_IDS) {
    selected[id] = true;
    weights[id] = 1;
    startDates[id] = fx[id][0].date;
  }
  return { selected, weights, startDates, window };
}

describe("BLEND-07 — computeScenario matches from-scratch numpy over the max-overlap window", () => {
  it("the fixture is the deterministic 6-series shape (staggered spans + one ended-tail member)", () => {
    // Sanity-pin the fixture so a fat-fingered edit that changes the dataset
    // (and would silently move every assertion below) fails loudly here.
    expect(STRATEGY_IDS).toEqual([
      "mm",
      "neon1",
      "pokeokx",
      "uc244",
      "okx",
      "bybit",
    ]);
    for (const id of STRATEGY_IDS) {
      expect(Array.isArray(fx[id])).toBe(true);
      expect(fx[id].length).toBeGreaterThan(0);
      expect(typeof fx[id][0].date).toBe("string");
      expect(typeof fx[id][0].value).toBe("number");
    }
    // pokeokx ends BEFORE the union end → the ended-tail member. Dates are
    // ISO "YYYY-MM-DD" so lexicographic string compare is chronological.
    const unionEnd = STRATEGY_IDS.map((id) => fx[id][fx[id].length - 1].date)
      .reduce((a, b) => (a > b ? a : b));
    const pokeokxEnd = fx["pokeokx"][fx["pokeokx"].length - 1].date;
    expect(pokeokxEnd < unionEnd).toBe(true);
  });

  it("the derived max-overlap window equals the numpy intersection window", () => {
    const spans = STRATEGY_IDS.map((id) => coverageSpanOf(fx[id])!);
    const window = defaultWindowFor(spans);
    expect(window).not.toBeNull();
    expect(window!.start).toBe(NUMPY.win_start);
    expect(window!.end).toBe(NUMPY.win_end);
  });

  it("the blend over the max-overlap window matches numpy to fp precision, divisor === live-member count", () => {
    const strategies = buildStrategies();
    const spans = STRATEGY_IDS.map((id) => coverageSpanOf(fx[id])!);
    const window = defaultWindowFor(spans)!;
    const state = buildState(window);
    const cache = buildDateMapCache(strategies);

    const m = computeScenario(strategies, state, cache);

    // Divisor === live-member count (all 6 cover the intersection window by
    // construction — the window stops at pokeokx's last day). This is the
    // constant, honest divisor: member_count, not the started-strategy count.
    expect(m.member_count).toBe(NUMPY.member_count);
    expect(m.member_ids).toEqual(NUMPY.member_ids);

    // Window axis: n === closed-window trading-day count; bounds === window.
    expect(m.n).toBe(NUMPY.n);
    expect(m.effective_start).toBe(NUMPY.win_start);
    expect(m.effective_end).toBe(NUMPY.win_end);

    // Metrics === numpy to fp precision. Payload rounds twr/cagr/vol/maxDD to 5
    // decimals and sharpe to 3 (scenario.ts:617-622); `toBeCloseTo` at that
    // precision is the "matched to fp precision" claim (raw series agree ~1e-10).
    expect(m.twr).toBeCloseTo(NUMPY.twr, 5);
    expect(m.cagr).toBeCloseTo(NUMPY.cagr, 5);
    expect(m.volatility).toBeCloseTo(NUMPY.volatility, 5);
    expect(m.sharpe).toBeCloseTo(NUMPY.sharpe, 3);
    expect(m.max_drawdown).toBeCloseTo(NUMPY.max_drawdown, 5);
  });

  it("[anti-dilution] extending the window past pokeokx's end EXCLUDES it — divisor drops to 5, ended member no longer divides", () => {
    // The whole point of v1.5: at a window that extends to the UNION end,
    // pokeokx (ended 2025-12-31) does NOT cover it and is dropped from the
    // divisor — it no longer dilutes the tail toward zero. Under the OLD
    // convention it would stay counted-and-zero-filled. This proves the ended
    // strategy is excluded, not silently kept.
    const strategies = buildStrategies();
    const cache = buildDateMapCache(strategies);
    const unionEnd = STRATEGY_IDS.map((id) => fx[id][fx[id].length - 1].date)
      .reduce((a, b) => (a > b ? a : b));
    const wide = buildState({ start: NUMPY.win_start, end: unionEnd });

    const m = computeScenario(strategies, wide, cache);

    expect(m.member_count).toBe(5);
    expect(m.member_ids).not.toContain("pokeokx");
    expect(m.member_ids).toEqual(["mm", "neon1", "uc244", "okx", "bybit"]);
  });
});
