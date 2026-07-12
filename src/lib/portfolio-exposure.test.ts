/**
 * Phase 98 / 98-03 (PI-01/PI-02/PI-03) — RED-first contract spec for the
 * server-only `allocator_holdings` read layer (`portfolio-exposure.ts`).
 *
 * Mocking convention mirrors `src/lib/queries.percentiles.test.ts`: a
 * `vi.hoisted` resolver feeds a thenable capturing query-builder chain, so a
 * test can (a) seed the rows the awaited query resolves to and (b) inspect the
 * `.select(...)` / `.eq(...)` / `.gte(...)` arguments the module issued. The
 * module exercises the real Supabase path (unlike the pure-helper
 * `queries.mandateIsSet.test.ts`), so a capturing chain — not a no-op stub — is
 * required. No live DB (project memory: live-DB `skipIf` tests never run in CI).
 *
 * Covers the seven behaviour clusters the plan pins:
 *   1. honest-empty (D-P7)          5. latest-asof-only snapshot
 *   2. owner gate + no-admin-import 6. no-zero-fill gap marking (+ computeAsofGaps units)
 *   3. secretless projection (T-98-08) 7. per-venue weight math (+ zero-gross skip, D-P3)
 *   4. signed net (D-P2)
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";

interface HoldingRow {
  asof: string;
  venue: string;
  symbol: string;
  holding_type: string;
  side: string;
  value_usd: number;
}

const holdingsResolver = vi.hoisted(() => ({
  rows: [] as HoldingRow[],
  error: null as unknown,
  selectArg: "" as string,
  eqCalls: [] as [string, unknown][],
  gteCalls: [] as [string, unknown][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.select = (arg: string) => {
        holdingsResolver.selectArg = arg;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        holdingsResolver.eqCalls.push([col, val]);
        return chain;
      };
      chain.gte = (col: string, val: unknown) => {
        holdingsResolver.gteCalls.push([col, val]);
        return chain;
      };
      chain.order = () => chain;
      chain.limit = () => chain;
      // The read awaits the chain directly. Make it thenable so `await query`
      // resolves to the seeded payload.
      chain.then = (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      ) =>
        Promise.resolve({
          data: holdingsResolver.rows,
          error: holdingsResolver.error,
        }).then(onFulfilled);
      return chain;
    },
  }),
}));

// The module MUST NOT import the admin client. Mock the path with a factory
// that throws if it is ever loaded — belt to the source-level braces below.
vi.mock("@/lib/supabase/admin", () => {
  throw new Error(
    "portfolio-exposure must not import @/lib/supabase/admin (T-98-07 owner-RLS boundary)",
  );
});

import {
  getLatestExposureSnapshot,
  getNetExposureSeries,
  getAllocationSeries,
  computeAsofGaps,
} from "./portfolio-exposure";

const USER_ID = "11111111-1111-1111-1111-111111111111";

function row(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    asof: "2026-07-01",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    side: "long",
    value_usd: 100,
    ...overrides,
  };
}

beforeEach(() => {
  holdingsResolver.rows = [];
  holdingsResolver.error = null;
  holdingsResolver.selectArg = "";
  holdingsResolver.eqCalls = [];
  holdingsResolver.gteCalls = [];
});

describe("computeAsofGaps — pure gap detection (missingSegments shape)", () => {
  it("empty input → []", () => {
    expect(computeAsofGaps([])).toEqual([]);
  });

  it("single day → []", () => {
    expect(computeAsofGaps(["2026-07-01"])).toEqual([]);
  });

  it("consecutive days → []", () => {
    expect(computeAsofGaps(["2026-07-01", "2026-07-02", "2026-07-03"])).toEqual(
      [],
    );
  });

  it("a 2-day interior gap → one span with inclusive `days`", () => {
    expect(computeAsofGaps(["2026-07-01", "2026-07-04"])).toEqual([
      { start: "2026-07-02", end: "2026-07-03", kind: "gap", days: 2 },
    ]);
  });

  it("uses UTC date arithmetic across a month boundary", () => {
    expect(computeAsofGaps(["2026-06-29", "2026-07-02"])).toEqual([
      { start: "2026-06-30", end: "2026-07-01", kind: "gap", days: 2 },
    ]);
  });
});

describe("getLatestExposureSnapshot", () => {
  it("honest-empty: zero rows → null (not a zero-filled snapshot)", async () => {
    holdingsResolver.rows = [];
    expect(await getLatestExposureSnapshot(USER_ID)).toBeNull();
  });

  it("owner gate: issues .eq('allocator_id', userId) and a 730-day .gte('asof') cap", async () => {
    holdingsResolver.rows = [row()];
    await getLatestExposureSnapshot(USER_ID);
    expect(holdingsResolver.eqCalls).toContainEqual(["allocator_id", USER_ID]);
    const gteCols = holdingsResolver.gteCalls.map((c) => c[0]);
    expect(gteCols).toContain("asof");
  });

  it("secretless projection: never selects raw_payload / api_key, includes the six allow-listed columns", async () => {
    holdingsResolver.rows = [row()];
    await getLatestExposureSnapshot(USER_ID);
    expect(holdingsResolver.selectArg).not.toMatch(/raw_payload|api_key/);
    for (const col of [
      "asof",
      "venue",
      "symbol",
      "holding_type",
      "side",
      "value_usd",
    ]) {
      expect(holdingsResolver.selectArg).toContain(col);
    }
  });

  it("signed net (D-P2): short is negated; net = 250, gross = 450", async () => {
    holdingsResolver.rows = [
      row({ symbol: "BTC", holding_type: "derivative", side: "short", value_usd: 100 }),
      row({ symbol: "ETH", holding_type: "derivative", side: "long", value_usd: 300 }),
      row({ symbol: "SOL", holding_type: "spot", side: "flat", value_usd: 50 }),
    ];
    const snap = await getLatestExposureSnapshot(USER_ID);
    expect(snap).not.toBeNull();
    expect(snap!.totalNetUsd).toBe(250);
    expect(snap!.totalGrossUsd).toBe(450);
    const shortSlice = snap!.slices.find((s) => s.side === "short");
    expect(shortSlice!.signedValueUsd).toBe(-100);
    expect(shortSlice!.valueUsd).toBe(100);
  });

  it("latest-asof only: slices come solely from the max asof", async () => {
    holdingsResolver.rows = [
      row({ asof: "2026-07-01", symbol: "OLD", value_usd: 999 }),
      row({ asof: "2026-07-02", symbol: "BTC", value_usd: 100 }),
      row({ asof: "2026-07-02", symbol: "ETH", value_usd: 200 }),
    ];
    const snap = await getLatestExposureSnapshot(USER_ID);
    expect(snap!.asof).toBe("2026-07-02");
    expect(snap!.slices.map((s) => s.symbol).sort()).toEqual(["BTC", "ETH"]);
    expect(snap!.slices.some((s) => s.symbol === "OLD")).toBe(false);
  });

  it("aggregates the (holding_type, venue, symbol, side) grain into one slice", async () => {
    holdingsResolver.rows = [
      row({ symbol: "BTC", value_usd: 100 }),
      row({ symbol: "BTC", value_usd: 40 }),
    ];
    const snap = await getLatestExposureSnapshot(USER_ID);
    expect(snap!.slices).toHaveLength(1);
    expect(snap!.slices[0].valueUsd).toBe(140);
  });
});

describe("getNetExposureSeries", () => {
  it("honest-empty: zero rows → { points: [], gaps: [] } (no fabricated point)", async () => {
    holdingsResolver.rows = [];
    const series = await getNetExposureSeries(USER_ID);
    expect(series.points).toEqual([]);
    expect(series.gaps).toEqual([]);
  });

  it("no zero-fill: emits a point per existing asof and MARKS the interior gap", async () => {
    holdingsResolver.rows = [
      row({ asof: "2026-07-01", side: "long", value_usd: 300 }),
      row({ asof: "2026-07-01", symbol: "ETH", side: "short", value_usd: 100 }),
      row({ asof: "2026-07-04", side: "long", value_usd: 200 }),
    ];
    const series = await getNetExposureSeries(USER_ID);
    // Only the two asof days that exist — never a synthetic 07-02 / 07-03.
    expect(series.points.map((p) => p.asof)).toEqual(["2026-07-01", "2026-07-04"]);
    const p1 = series.points.find((p) => p.asof === "2026-07-01")!;
    expect(p1.netUsd).toBe(200); // 300 long − 100 short
    expect(p1.grossUsd).toBe(400);
    expect(series.gaps).toEqual([
      { start: "2026-07-02", end: "2026-07-03", kind: "gap", days: 2 },
    ]);
  });
});

describe("getAllocationSeries", () => {
  it("honest-empty: zero rows → { points: [], gaps: [] }", async () => {
    holdingsResolver.rows = [];
    const series = await getAllocationSeries(USER_ID);
    expect(series.points).toEqual([]);
    expect(series.gaps).toEqual([]);
  });

  it("per-venue weights (D-P3): venue A gross 300 / venue B gross 100 → 0.75 / 0.25 summing to 1", async () => {
    holdingsResolver.rows = [
      row({ asof: "2026-07-01", venue: "A", value_usd: 300 }),
      row({ asof: "2026-07-01", venue: "B", value_usd: 100 }),
    ];
    const series = await getAllocationSeries(USER_ID);
    expect(series.points).toHaveLength(1);
    const byVenue = Object.fromEntries(
      series.points[0].venues.map((v) => [v.venue, v.weight]),
    );
    expect(byVenue.A).toBeCloseTo(0.75, 9);
    expect(byVenue.B).toBeCloseTo(0.25, 9);
    const sum = series.points[0].venues.reduce((a, v) => a + v.weight, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("zero-gross asof emits NO AllocationPoint (no NaN weights)", async () => {
    holdingsResolver.rows = [
      row({ asof: "2026-07-01", venue: "A", side: "flat", value_usd: 0 }),
      row({ asof: "2026-07-01", venue: "B", side: "flat", value_usd: 0 }),
    ];
    const series = await getAllocationSeries(USER_ID);
    expect(series.points).toEqual([]);
  });
});

describe("no-admin-import (T-98-07 owner-RLS boundary, source-level)", () => {
  it("the module source imports nothing from @/lib/supabase/admin", () => {
    const modulePath = resolve(
      process.cwd(),
      "src/lib/portfolio-exposure.ts",
    );
    const src = readFileSync(modulePath, "utf8");
    expect(src).not.toMatch(/supabase\/admin/);
    expect(src).not.toMatch(/createAdminClient/);
  });
});
