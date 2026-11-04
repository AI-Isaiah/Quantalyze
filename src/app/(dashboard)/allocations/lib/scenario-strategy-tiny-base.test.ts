/**
 * Phase 188 (TINYBASE) round 1, MEDIUM-4, D-07: a STRATEGY leg (a book strategy or a drawer-added
 * one) names the days the tiny-base rule left out of its stored series, so the engine sits it out
 * of them exactly as it does a key leg. Before this, only the per-key units carried
 * `undefined_return_days`, so a strategy leg that lacked a day another leg put on the axis was
 * 0-filled at its full weight: a flat 0% for a day the rule says has no return.
 *
 * Fixture (synthetic, typed beside the sums): 2026-03-01..2026-03-06. `key-a` has a return every
 * day. `strat-x` has none on 2026-03-03 and 2026-03-04 (the days it names). Weights 0.5 / 0.5.
 * On a shared day the blend is (rA + rX) / 2; on a named day it is `key-a` alone (0.02 on
 * 2026-03-03, -0.01 on 2026-03-04). The old arithmetic read (rA + 0) / 2 = 0.01 and -0.005.
 */
import { describe, it, expect } from "vitest";
import type { DailyPoint } from "@/lib/scenario";
import type { ScenarioDraft } from "./scenario-state";
import { computeMetricsForDraft, type ScenarioCompareInputs } from "./scenario-compare";

const DAYS = Array.from({ length: 12 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`);
const NAMED = ["2026-03-03", "2026-03-04"];
const A = [0.01, -0.005, 0.02, -0.01, 0.015, -0.01, 0.02, -0.01, 0.005, 0.01, -0.02, 0.012];
const X_DAYS = DAYS.filter((d) => !NAMED.includes(d));
const X = [0.03, -0.02, 0.01, 0.005, -0.015, 0.025, 0.02, -0.01, 0.015, -0.005];

const aSeries: DailyPoint[] = DAYS.map((date, i) => ({ date, value: A[i] }));
const xSeries: DailyPoint[] = X_DAYS.map((date, i) => ({ date, value: X[i] }));

function inputs(withNamedDays: boolean): ScenarioCompareInputs {
  return {
    addedStrategyReturnsLookup: { "strat-x": xSeries },
    addedStrategyMetadataLookup: {
      "strat-x": {
        disclosure_tier: "public",
        cagr: null,
        sharpe: null,
        asset_class: "crypto",
        ...(withNamedDays ? { undefined_return_days: NAMED } : {}),
      },
    },
    perKeyReturnsByApiKeyId: { "key-a": aSeries },
    contributingApiKeyIds: ["key-a"],
    eligibleApiKeyIds: ["key-a"],
    equityByApiKeyId: { "key-a": 10_000 },
    perKeyDailiesGateSatisfied: true,
  };
}

const draft: ScenarioDraft = {
  schema_version: 2,
  init_holdings_fingerprint: "fp",
  toggleByScopeRef: {},
  addedStrategies: [
    { id: "strat-x" as ScenarioDraft["addedStrategies"][number]["id"], name: "X", markets: [], strategy_types: [] },
  ],
  weightOverrides: { "key-a": 0.5, "strat-x": 0.5 },
  memberKeyIds: ["key-a"],
  lastEditedAt: "2026-03-12T00:00:00.000Z",
};

function at(m: ReturnType<typeof computeMetricsForDraft>, date: string): number {
  const p = (m.portfolio_daily_returns ?? []).find((r) => r.date === date);
  if (!p) throw new Error(`no portfolio day ${date}`);
  return p.value;
}

describe("a strategy leg sits out of its tiny-base days (188 D-07, round 1 MEDIUM-4)", () => {
  it("reads a named day as the other leg alone, never as the strategy's flat 0%", () => {
    const m = computeMetricsForDraft(draft, inputs(true));
    expect(at(m, "2026-03-03")).toBeCloseTo(0.02, 12);
    expect(at(m, "2026-03-04")).toBeCloseTo(-0.01, 12);
    // A shared day is untouched: (0.01 + 0.03) / 2.
    expect(at(m, "2026-03-01")).toBeCloseTo(0.02, 12);
  });

  it("without the list the old arithmetic holds (the day 0-fills at the strategy's weight)", () => {
    const m = computeMetricsForDraft(draft, inputs(false));
    expect(at(m, "2026-03-03")).toBeCloseTo(0.01, 12);
    expect(at(m, "2026-03-04")).toBeCloseTo(-0.005, 12);
  });
});
