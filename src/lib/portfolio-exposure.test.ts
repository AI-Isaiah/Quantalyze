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

// PostgREST silently caps every response at `max_rows` (supabase/config.toml:18
// = 1000; hosted default also 1000). The mock SIMULATES that cap for any query
// that applies neither `.range()` nor `.limit()` — this is what makes the F-1
// regression genuinely RED against the old single unbounded `.order(asof asc)`
// query (it drops the newest rows) and GREEN once the reads paginate / narrow.
const POSTGREST_MAX_ROWS = 1000;

const holdingsResolver = vi.hoisted(() => ({
  rows: [] as HoldingRow[],
  error: null as unknown,
  selectArg: "" as string,
  eqCalls: [] as [string, unknown][],
  gteCalls: [] as [string, unknown][],
  orderCalls: [] as [string, boolean][],
  limitCalls: [] as number[],
  rangeCalls: [] as [number, number][],
}));

// Row columns the mock can actually filter on (allocator_id is NOT projected
// onto the seeded HoldingRow, so an `.eq("allocator_id", …)` is a no-op filter
// here — it is still captured in `eqCalls` for the owner-gate assertion).
const FILTERABLE_COLS = new Set([
  "asof",
  "venue",
  "symbol",
  "holding_type",
  "side",
]);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      // Per-query builder state so a two-step read (max-asof then eq-asof) and
      // a paginated read (repeated `.range`) each resolve against their OWN
      // filters, while global resolver arrays capture the query CONTRACT.
      const local = {
        eqs: [] as [string, unknown][],
        orderedByAsof: false,
        orderAsc: true,
        limitN: null as number | null,
        range: null as [number, number] | null,
      };
      const chain: Record<string, unknown> = {};
      chain.select = (arg: string) => {
        holdingsResolver.selectArg = arg;
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        holdingsResolver.eqCalls.push([col, val]);
        local.eqs.push([col, val]);
        return chain;
      };
      chain.gte = (col: string, val: unknown) => {
        holdingsResolver.gteCalls.push([col, val]);
        return chain;
      };
      chain.order = (col: string, opts?: { ascending?: boolean }) => {
        const asc = opts?.ascending ?? true;
        holdingsResolver.orderCalls.push([col, asc]);
        if (col === "asof") {
          local.orderedByAsof = true;
          local.orderAsc = asc;
        }
        return chain;
      };
      chain.limit = (n: number) => {
        holdingsResolver.limitCalls.push(n);
        local.limitN = n;
        return chain;
      };
      chain.range = (from: number, to: number) => {
        holdingsResolver.rangeCalls.push([from, to]);
        local.range = [from, to];
        return chain;
      };
      // The read awaits the chain directly. Make it thenable so `await query`
      // resolves to the seeded payload, honouring this query's own filters.
      chain.then = (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      ) => {
        if (holdingsResolver.error) {
          return Promise.resolve({
            data: null,
            error: holdingsResolver.error,
          }).then(onFulfilled);
        }
        let data = holdingsResolver.rows.slice();
        for (const [col, val] of local.eqs) {
          if (FILTERABLE_COLS.has(col)) {
            data = data.filter(
              (r) => (r as unknown as Record<string, unknown>)[col] === val,
            );
          }
        }
        if (local.orderedByAsof) {
          data.sort((a, b) => (a.asof < b.asof ? -1 : a.asof > b.asof ? 1 : 0));
          if (!local.orderAsc) data.reverse();
        }
        if (local.range) {
          data = data.slice(local.range[0], local.range[1] + 1);
        } else if (local.limitN !== null) {
          data = data.slice(0, local.limitN);
        } else {
          // No range, no limit → PostgREST silently truncates at max_rows.
          data = data.slice(0, POSTGREST_MAX_ROWS);
        }
        return Promise.resolve({ data, error: null }).then(onFulfilled);
      };
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
  holdingsResolver.orderCalls = [];
  holdingsResolver.limitCalls = [];
  holdingsResolver.rangeCalls = [];
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

// A row on the (2023-01-01 + i days) asof so an ascending sort places the
// NEWEST asof strictly last — beyond the 1000-row PostgREST cap for i > 999.
function seqRow(i: number): HoldingRow {
  const asof = new Date(Date.UTC(2023, 0, 1) + i * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return row({ asof, symbol: `S${i}`, value_usd: 100 });
}

describe("F-1 (v1.10): PostgREST 1000-row truncation must not drop newest holdings", () => {
  it("getLatestExposureSnapshot uses the two-step max-asof-then-eq path (not a full-window scan)", async () => {
    holdingsResolver.rows = [
      row({ asof: "2026-07-01", symbol: "OLD", value_usd: 999 }),
      row({ asof: "2026-07-05", symbol: "BTC", value_usd: 100 }),
    ];
    const snap = await getLatestExposureSnapshot(USER_ID);

    // Step 1: a descending single-row read to find the latest asof.
    expect(holdingsResolver.orderCalls).toContainEqual(["asof", false]);
    expect(holdingsResolver.limitCalls).toContain(1);
    // Step 2: fetch holdings AT that exact asof (eq, not a window scan).
    expect(holdingsResolver.eqCalls).toContainEqual(["asof", "2026-07-05"]);
    // The prior full-window scan ordered ascending only, with no limit.
    expect(holdingsResolver.orderCalls).not.toContainEqual(["asof", true]);
    expect(snap!.asof).toBe("2026-07-05");
    expect(snap!.slices.map((s) => s.symbol)).toEqual(["BTC"]);
  });

  it("getNetExposureSeries paginates a >1000-row window and returns the COMPLETE series incl. the newest asof", async () => {
    const big = Array.from({ length: 1500 }, (_, i) => seqRow(i));
    const newestAsof = big[big.length - 1].asof;
    holdingsResolver.rows = big;

    const series = await getNetExposureSeries(USER_ID);

    // Multiple `.range()` calls => it paginated rather than issuing one
    // unbounded query that PostgREST would silently cap at 1000.
    expect(holdingsResolver.rangeCalls.length).toBeGreaterThan(1);
    // No row silently dropped — every asof, including the newest, is present.
    expect(series.points).toHaveLength(1500);
    expect(series.points.map((p) => p.asof)).toContain(newestAsof);
    expect(series.points[series.points.length - 1].asof).toBe(newestAsof);
  });

  it("getAllocationSeries also paginates a >1000-row window (no dropped newest asof)", async () => {
    const big = Array.from({ length: 1200 }, (_, i) => seqRow(i));
    const newestAsof = big[big.length - 1].asof;
    holdingsResolver.rows = big;

    const series = await getAllocationSeries(USER_ID);

    expect(holdingsResolver.rangeCalls.length).toBeGreaterThan(1);
    expect(series.points).toHaveLength(1200);
    expect(series.points.map((p) => p.asof)).toContain(newestAsof);
  });
});

describe("F-2 (v1.10): a boundary zero-gross asof is MARKED as a gap, never silently dropped", () => {
  it("leading AND trailing zero-gross asofs both become marked gaps", async () => {
    holdingsResolver.rows = [
      // Leading zero-gross day (skipped, was silently vanishing).
      row({ asof: "2026-07-01", venue: "A", side: "flat", value_usd: 0 }),
      row({ asof: "2026-07-01", venue: "B", side: "flat", value_usd: 0 }),
      // Two real points.
      row({ asof: "2026-07-02", venue: "A", value_usd: 300 }),
      row({ asof: "2026-07-02", venue: "B", value_usd: 100 }),
      row({ asof: "2026-07-03", venue: "A", value_usd: 200 }),
      // Trailing zero-gross day (skipped, was silently vanishing).
      row({ asof: "2026-07-04", venue: "A", side: "flat", value_usd: 0 }),
      row({ asof: "2026-07-04", venue: "B", side: "flat", value_usd: 0 }),
    ];

    const series = await getAllocationSeries(USER_ID);

    // Points only for the non-zero-gross asofs (unchanged behaviour).
    expect(series.points.map((p) => p.asof)).toEqual([
      "2026-07-02",
      "2026-07-03",
    ]);
    // Both boundary skips are now marked as single-day gaps — the prior
    // computeAsofGaps(points) produced [] (the two points are consecutive).
    expect(series.gaps).toEqual([
      { start: "2026-07-01", end: "2026-07-01", kind: "gap", days: 1 },
      { start: "2026-07-04", end: "2026-07-04", kind: "gap", days: 1 },
    ]);
  });

  it("an interior zero-gross asof is still marked (regression guard for the pre-existing interior case)", async () => {
    holdingsResolver.rows = [
      row({ asof: "2026-07-01", venue: "A", value_usd: 300 }),
      row({ asof: "2026-07-02", venue: "A", side: "flat", value_usd: 0 }),
      row({ asof: "2026-07-03", venue: "A", value_usd: 200 }),
    ];

    const series = await getAllocationSeries(USER_ID);

    expect(series.points.map((p) => p.asof)).toEqual([
      "2026-07-01",
      "2026-07-03",
    ]);
    expect(series.gaps).toEqual([
      { start: "2026-07-02", end: "2026-07-02", kind: "gap", days: 1 },
    ]);
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
