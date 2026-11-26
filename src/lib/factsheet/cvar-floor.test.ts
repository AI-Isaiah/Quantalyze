import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFactsheetPayload } from "./build-payload";
import { compute } from "./compute";
import { buildAllocatorPortfolioFactsheetPayload } from "./allocator-portfolio-payload";
import { CVAR_MIN_OBS } from "@/lib/figure-conventions";
import { FIGURE_DEFS_VERSION } from "@/lib/figure-gate";
import type { DailyReturn } from "./types";

/**
 * Phase 236 FIG-03 (F-6, CONTEXT Q2 "Total record only", founder 2026-11-25): CVaR is null when
 * the TOTAL record has fewer than CVAR_MIN_OBS = 60 observations, and a zoomed window always
 * shows it. The whole-record factsheet figures are floored where `overlaid` is built in
 * `buildFactsheetPayload`, so both the strategy factsheet and the allocator-portfolio payload
 * inherit it, whether the figure came from the stored row or the computed fallback.
 *
 * The vectors are read from `figure_parity_vectors.json` `cvar_floor`, whose expected values are
 * hand-derived from the literal smallest returns (never produced by a production helper).
 */

type FloorVector = {
  name: string;
  returns: number[];
  expected_var: number | null;
  expected_cvar: number | null;
};

const FIXTURE = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../analytics-service/tests/fixtures/figure_parity_vectors.json"),
    "utf8",
  ),
) as { cvar_floor: { vectors: FloorVector[] } };

const vec = (name: string): FloorVector => {
  const v = FIXTURE.cvar_floor.vectors.find((x) => x.name === name);
  if (!v) throw new Error(`cvar_floor vector ${name} is missing`);
  return v;
};

function datedSeries(returns: number[], start = "2025-03-15"): DailyReturn[] {
  let t = Date.parse(`${start}T00:00:00Z`);
  return returns.map((value) => {
    const row = { date: new Date(t).toISOString().slice(0, 10), value };
    t += 86_400_000;
    return row;
  });
}

const STRATEGY = {
  id: "s-236-07",
  name: "Cvar Floor Fixture",
  types: ["quant"],
  markets: ["crypto"],
  computedAt: "2025-09-01T00:00:00Z",
  trustTier: null,
  assetClass: "crypto",
  description: "fixture",
  subtypes: ["basis_trade"],
  supportedExchanges: ["deribit"],
  leverageRange: "0-3x",
  aum: 1_000_000,
  maxCapacity: 5_000_000,
  avgDailyTurnover: 250_000,
  startDate: "2025-03-15",
  benchmark: "BTC",
  ingestSource: "csv" as const,
};

const build = (returns: number[], opts?: Parameters<typeof buildFactsheetPayload>[2]) =>
  buildFactsheetPayload(STRATEGY, datedSeries(returns), opts)!.strategyMetrics;

describe("CVAR_MIN_OBS is the constant the fixture names", () => {
  it("the fixture's floor vectors straddle exactly CVAR_MIN_OBS", () => {
    expect(vec("n59_below_floor").returns).toHaveLength(CVAR_MIN_OBS - 1);
    expect(vec("n60_at_floor").returns).toHaveLength(CVAR_MIN_OBS);
  });
});

describe("whole-record CVaR floor through buildFactsheetPayload (Q2, FIG-03)", () => {
  it("n = 59 is below the floor: cvar95 is NaN (the dash) while VaR still shows", () => {
    const v = vec("n59_below_floor");
    const m = build(v.returns);
    expect(Number.isNaN(m.cvar95)).toBe(true);
    // VaR is never floored (F-6 names CVaR only).
    expect(m.var95).toBeCloseTo(v.expected_var as number, 12);
  });

  it("n = 60 is at the floor: cvar95 is the closed-form mean of the 3 smallest returns", () => {
    const v = vec("n60_at_floor");
    const m = build(v.returns);
    expect(m.cvar95).toBeCloseTo(v.expected_cvar as number, 12);
    expect(m.var95).toBeCloseTo(v.expected_var as number, 12);
  });

  it("a v2 (unmigrated) stored row falls back to the computed figure, which the floor then nulls at n = 59", () => {
    const m = build(vec("n59_below_floor").returns, {
      storedFigureDefs: { figureDefsVersion: FIGURE_DEFS_VERSION - 1, sixMonth: null, threeMonth: null, var95: -0.04, cvar95: -0.05 },
    });
    expect(Number.isNaN(m.cvar95)).toBe(true);
  });

  it("a v3 stored null stays null (a stored null never falls back to the computed value) at n = 60", () => {
    const m = build(vec("n60_at_floor").returns, {
      storedFigureDefs: { figureDefsVersion: FIGURE_DEFS_VERSION, sixMonth: null, threeMonth: null, var95: -0.02, cvar95: null },
    });
    expect(Number.isNaN(m.cvar95)).toBe(true);
  });

  it("a v3 stored non-null CVaR on a record under the floor is still withheld (the floor reads the record, not the figure's source)", () => {
    const m = build(vec("n59_below_floor").returns, {
      storedFigureDefs: { figureDefsVersion: FIGURE_DEFS_VERSION, sixMonth: null, threeMonth: null, var95: -0.04, cvar95: -0.05 },
    });
    expect(Number.isNaN(m.cvar95)).toBe(true);
  });

  it("the floor counts the whole record's own observations, not the stored record_observations", () => {
    // 59 rows are 59 observations whatever the stored count says: the total record is short.
    const withheld = build(vec("n59_below_floor").returns, {
      recordObservations: 400,
      storedFigureDefs: { figureDefsVersion: FIGURE_DEFS_VERSION, sixMonth: null, threeMonth: null, var95: -0.04, cvar95: -0.05 },
    });
    expect(Number.isNaN(withheld.cvar95)).toBe(true);
    // And the reverse: 60 rows clear the floor whatever the stored count says.
    const shown = build(vec("n60_at_floor").returns, { recordObservations: 59 });
    expect(shown.cvar95).toBeCloseTo(vec("n60_at_floor").expected_cvar as number, 12);
  });

  it("a chain-broken record with 200 total days and 40 after the break shows CVaR (review CR-02)", () => {
    // Python floors stored cvar on len(returns.dropna()) of the WHOLE record (200 >= 60), while the
    // stored record_observations counts only the post-break headline suffix (40). The factsheet must
    // floor on the same count Python does, so the stored CVaR shows. 190 days at +0.001 and 10 at
    // -0.03 make the computed fallback hand-derivable too: k = floor(0.05 * 200) = 10, so the CVaR
    // is the mean of the ten -0.03 days.
    const returns = Array.from({ length: 200 }, (_, i) => (i < 10 ? -0.03 : 0.001));
    const dated = datedSeries(returns);
    const dataQuality = {
      composite: false,
      insufficientWindow: false,
      twrChainBroken: true,
      headlineCoversFrom: dated[160].date,
    } as NonNullable<Parameters<typeof buildFactsheetPayload>[2]>["dataQuality"];
    const chainBroken = {
      recordObservations: 40,
      dataQuality,
    };
    const stored = buildFactsheetPayload(STRATEGY, dated, {
      ...chainBroken,
      storedFigureDefs: { figureDefsVersion: FIGURE_DEFS_VERSION, sixMonth: null, threeMonth: null, var95: -0.04, cvar95: -0.05 },
    })!.strategyMetrics;
    expect(stored.cvar95).toBeCloseTo(-0.05, 12);
    const computed = buildFactsheetPayload(STRATEGY, dated, chainBroken)!.strategyMetrics;
    expect(computed.cvar95).toBeCloseTo(-0.03, 12);
  });
});

describe("the allocator portfolio payload inherits the floor", () => {
  it("a 59-day book carries cvar95 NaN and a 60-day book carries the closed-form value", () => {
    const short = buildAllocatorPortfolioFactsheetPayload([], {
      allocatorId: "alloc-236",
      dailyReturns: datedSeries(vec("n59_below_floor").returns),
    });
    expect(short).not.toBeNull();
    expect(Number.isNaN(short!.strategyMetrics.cvar95)).toBe(true);

    const full = buildAllocatorPortfolioFactsheetPayload([], {
      allocatorId: "alloc-236",
      dailyReturns: datedSeries(vec("n60_at_floor").returns),
    });
    expect(full!.strategyMetrics.cvar95).toBeCloseTo(-0.05, 12);
  });
});

describe("a zoomed window always shows CVaR (T-236-15)", () => {
  it("compute() over a narrowed 30-observation slice of a 400-observation record shows CVaR", () => {
    // compute() has no floor: it cannot tell a total record from a window. 400 returns whose
    // worst day is -0.10; the last 30 contain a -0.07 day, so the window's CVaR is finite.
    const returns: number[] = Array.from({ length: 400 }, (_, i) => (i % 7 === 0 ? -0.01 : 0.004));
    returns[3] = -0.1;
    returns[380] = -0.07;
    const dated = datedSeries(returns);
    const win = dated.slice(-30);
    const winValues = win.map((d) => d.value);
    const winDates = win.map((d) => d.date);
    const m = compute(winValues, winDates, 0, 365);
    expect(Number.isFinite(m.cvar95)).toBe(true);
    expect(m.cvar95).toBeLessThan(0);
  });
});
