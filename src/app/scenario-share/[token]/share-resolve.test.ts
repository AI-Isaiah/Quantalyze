/**
 * Plan 25-04 / SHARE-02 — the DI-23-01 honest-absence unit test.
 *
 * `resolveSharedScenario` is the PURE decision layer between the leak-scoped
 * `get_shared_scenario` RPC row and the recipient page render. The single
 * load-bearing invariant it encodes is the **DI-23-01 landmine**:
 *
 *   The dashboard codec (`scenarioDraftCodec`) returns `value = defaultDraft`
 *   on its `"readonly"` (version_ahead) and `"reset"` (parse_failed /
 *   schema_invalid / version_mismatch) outcomes. On the dashboard that default
 *   is the VIEWER'S live holdings. On a PUBLIC share page there is no viewer
 *   book, but rendering `.value` on a non-"ok" outcome would still surface a
 *   live-book-SHAPED object to an anonymous recipient. So the helper MUST
 *   branch on `outcome` and NEVER read `.value` unless `outcome === "ok"`.
 *
 * These tests mutation-prove that a version-ahead / garbage draft yields
 * `kind:"honest-absence"` and NEVER a computed curve / metrics object — i.e.
 * the helper cannot regress into reading the codec default and rendering it.
 *
 * They also pin the compute path: a valid v2 draft with a published series
 * resolves to `kind:"ok"` with non-null `computeScenario` metrics, and an
 * empty-`addedStrategies` draft resolves to `kind:"ok"` carrying the engine's
 * degenerate all-null shape (series=[] is expected, not a bug).
 */
import { describe, it, expect } from "vitest";

import { resolveSharedScenario } from "./share-resolve";
import {
  SCENARIO_SCHEMA_VERSION,
  type ScenarioDraft,
} from "@/app/(dashboard)/allocations/lib/scenario-state";
import type { DailyPoint } from "@/lib/scenario";

// --- Fixtures --------------------------------------------------------------

const STRAT_A = "11111111-1111-4111-8111-111111111111";
const STRAT_B = "22222222-2222-4222-8222-222222222222";

/** A long, drifting daily-return series so computeScenario clears its n>=10
 *  floor and produces non-null metrics. 40 points, small positive drift. */
function makeSeries(seedOffset: number): DailyPoint[] {
  const out: DailyPoint[] = [];
  const start = new Date("2023-01-01T00:00:00Z");
  for (let i = 0; i < 40; i += 1) {
    const d = new Date(start.getTime() + i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    // Deterministic, non-constant series (avoids zero-variance degeneracy).
    const value = 0.001 + 0.002 * Math.sin((i + seedOffset) / 3);
    out.push({ date, value });
  }
  return out;
}

/** A valid v2 draft with two added strategies at equal weight. */
function okDraft(): ScenarioDraft {
  return {
    schema_version: SCENARIO_SCHEMA_VERSION, // 2 — the live constant
    init_holdings_fingerprint: "BTC:binance:spot",
    toggleByScopeRef: { [STRAT_A]: true, [STRAT_B]: true },
    addedStrategies: [
      { id: STRAT_A as never, name: "Alpha", markets: ["BTC"], strategy_types: ["trend"] },
      { id: STRAT_B as never, name: "Beta", markets: ["ETH"], strategy_types: ["mr"] },
    ],
    weightOverrides: { [STRAT_A]: 0.5, [STRAT_B]: 0.5 },
    lastEditedAt: "2026-06-22T00:00:00.000Z",
  };
}

/** The RPC series rows for the two added strategies. */
function okSeriesRows() {
  return [
    { strategy_id: STRAT_A, daily_returns: makeSeries(0) },
    { strategy_id: STRAT_B, daily_returns: makeSeries(7) },
  ];
}

// --- Tests -----------------------------------------------------------------

describe("resolveSharedScenario — DI-23-01 honest-absence (SHARE-02)", () => {
  it("version-ahead draft (schema_version > live SCENARIO_SCHEMA_VERSION) → honest-absence, NEVER a curve", () => {
    // schema_version = 3 is strictly ahead of the live constant (2). The codec
    // returns outcome:"readonly" with value=defaultDraft — reading that here
    // would leak a live-book-shaped object. The helper must honest-absence it.
    expect(SCENARIO_SCHEMA_VERSION).toBe(2); // pin against the live constant, not "1"
    const aheadDraft = { ...okDraft(), schema_version: SCENARIO_SCHEMA_VERSION + 1 };

    const result = resolveSharedScenario(
      { name: "Future scenario", draft: aheadDraft, schema_version: 3, series: okSeriesRows() },
      makeSeries(3),
    );

    expect(result.kind).toBe("honest-absence");
    // Mutation-proof: the result carries NO computed/curve fields. A regression
    // that read `.value` on the readonly outcome would produce a kind:"ok".
    expect(result).not.toHaveProperty("metrics");
    expect(result).not.toHaveProperty("portfolioDaily");
  });

  it("unparseable / garbage draft → honest-absence (reset outcome), NEVER a curve", () => {
    // A non-object / shape-invalid draft fails the codec's whole-shape parse →
    // outcome:"reset", value=defaultDraft. Must honest-absence, never render.
    const garbage = { not: "a draft", schema_version: 2 } as unknown as ScenarioDraft;

    const result = resolveSharedScenario(
      { name: "Broken", draft: garbage, schema_version: 2, series: [] },
      makeSeries(0),
    );

    expect(result.kind).toBe("honest-absence");
    expect(result).not.toHaveProperty("metrics");
  });

  it("valid ok draft with a published series → kind:'ok' with non-null computeScenario metrics", () => {
    const result = resolveSharedScenario(
      { name: "Two-strategy blend", draft: okDraft(), schema_version: 2, series: okSeriesRows() },
      makeSeries(11),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.name).toBe("Two-strategy blend");
    // Non-degenerate: 40 overlapping days, 2 strategies → real metrics + curve.
    expect(result.metrics.n).toBeGreaterThanOrEqual(10);
    expect(result.metrics.twr).not.toBeNull();
    expect(result.metrics.correlation_matrix).not.toBeNull();
    expect(result.metrics.equity_curve.length).toBeGreaterThan(0);
    expect(result.portfolioDaily.length).toBeGreaterThan(0);
  });

  it("ok draft with EMPTY addedStrategies (series=[]) → kind:'ok' with the degenerate all-null shape", () => {
    const emptyDraft: ScenarioDraft = {
      ...okDraft(),
      toggleByScopeRef: {},
      addedStrategies: [],
      weightOverrides: {},
    };

    const result = resolveSharedScenario(
      { name: "Holdings reweight only", draft: emptyDraft, schema_version: 2, series: [] },
      makeSeries(0),
    );

    // series=[] is the EXPECTED state for a holdings-only reweight, not a bug:
    // still kind:"ok", but the engine returns the all-null degenerate shape so
    // the components render their honest empty states.
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.metrics.n).toBe(0);
    expect(result.metrics.twr).toBeNull();
    expect(result.metrics.correlation_matrix).toBeNull();
    expect(result.metrics.equity_curve).toEqual([]);
    expect(result.portfolioDaily).toEqual([]);
  });

  it("returns the strategy name map for the resolved series (de-aliased labels for the heatmap)", () => {
    const result = resolveSharedScenario(
      { name: "Blend", draft: okDraft(), schema_version: 2, series: okSeriesRows() },
      [],
    );
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.strategyNames[STRAT_A]).toBe("Alpha");
    expect(result.strategyNames[STRAT_B]).toBe("Beta");
  });
});
