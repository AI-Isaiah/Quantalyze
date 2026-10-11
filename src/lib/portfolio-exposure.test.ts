/**
 * Phase 98 / 98-03 (PI-02/PI-03) — RED-first contract spec for the
 * server-only `allocator_holdings` read layer (`portfolio-exposure.ts`).
 *
 * Phase 170.4 plan 01 (D-01): the allocator-wide "latest snapshot" read (PI-01)
 * is retired from this module. The current Exposure card is built from the
 * dashboard payload's per-key holdings (allocations/lib/exposure-snapshot.ts,
 * tested there), so what these specs cover is the two over-time series (D-03).
 *
 * Mocking convention mirrors `src/lib/queries.percentiles.test.ts`: a
 * `vi.hoisted` resolver feeds a thenable capturing query-builder chain, so a
 * test can (a) seed the rows the awaited query resolves to and (b) inspect the
 * `.select(...)` / `.eq(...)` / `.gte(...)` arguments the module issued. The
 * module exercises the real Supabase path (unlike the pure-helper
 * `queries.mandateIsSet.test.ts`), so a capturing chain — not a no-op stub — is
 * required. No live DB (project memory: live-DB `skipIf` tests never run in CI).
 *
 * Covers the behaviour clusters the series reads pin:
 *   1. honest-empty (D-P7)             4. signed net (D-P2)
 *   2. owner gate + no-admin-import    5. no-zero-fill gap marking (+ computeAsofGaps units)
 *   3. secretless projection (T-98-08) 6. per-venue weight math (+ zero-gross skip, D-P3)
 *
 * Phase 170.4 plan 14 (D-11, D-10, D-08, D-03): the series count one exchange
 * account once per (day, holding_type) by plan 11's `oneKeyPerAccountDay`
 * applied per `asof`, so the mock is table-aware (`allocator_holdings` and the
 * owner's `api_keys` identity read; any other table throws) and every row
 * carries `api_key_id` and `updated_at`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { KEY_IDENTITY_COLUMNS } from "./latest-holdings-per-key";

interface HoldingRow {
  asof: string;
  venue: string;
  symbol: string;
  holding_type: string;
  side: string;
  value_usd: number;
  api_key_id: string;
  updated_at: string;
}

/** One `api_keys` identity row, the columns `KEY_IDENTITY_COLUMNS` selects. */
interface KeyRow {
  id: string;
  exchange: string | null;
  venue_account_id: string | null;
  account_share_kind: string | null;
  account_shared_with_api_key_id: string | null;
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

// The owner's key-identity read (`api_keys`). Honours `.limit()` like the
// holdings chain, so the cap case can seed exactly the row cap.
const keysResolver = vi.hoisted(() => ({
  rows: [] as unknown[],
  error: null as unknown,
  selectArg: "" as string,
  eqCalls: [] as [string, unknown][],
  limitCalls: [] as number[],
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
    from: (table: string) => {
      if (table === "api_keys") {
        let limitN: number | null = null;
        const keysChain: Record<string, unknown> = {};
        keysChain.select = (arg: string) => {
          keysResolver.selectArg = arg;
          return keysChain;
        };
        keysChain.eq = (col: string, val: unknown) => {
          keysResolver.eqCalls.push([col, val]);
          return keysChain;
        };
        keysChain.limit = (n: number) => {
          keysResolver.limitCalls.push(n);
          limitN = n;
          return keysChain;
        };
        keysChain.then = (
          onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
        ) => {
          if (keysResolver.error) {
            return Promise.resolve({
              data: null,
              error: keysResolver.error,
            }).then(onFulfilled);
          }
          const data =
            limitN === null
              ? keysResolver.rows.slice(0, POSTGREST_MAX_ROWS)
              : keysResolver.rows.slice(0, limitN);
          return Promise.resolve({ data, error: null }).then(onFulfilled);
        };
        return keysChain;
      }
      // Any other table is an unplanned read: fail loud, never fall through to
      // the holdings chain.
      if (table !== "allocator_holdings") {
        throw new Error(`unexpected table read: ${table}`);
      }
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
  getNetExposureSeries,
  getAllocationSeries,
  computeAsofGaps,
} from "./portfolio-exposure";

const USER_ID = "11111111-1111-1111-1111-111111111111";

// Fixed key ids. K1 is the default key of `row()`; K1 and K2 share one account
// in the D-11 cases, K3 and K4 are on distinct accounts.
const K1 = "aaaaaaaa-0000-4000-8000-000000000001";
const K2 = "aaaaaaaa-0000-4000-8000-000000000002";
const K3 = "aaaaaaaa-0000-4000-8000-000000000003";
const K4 = "aaaaaaaa-0000-4000-8000-000000000004";

function row(overrides: Partial<HoldingRow> = {}): HoldingRow {
  return {
    asof: "2026-07-01",
    venue: "binance",
    symbol: "BTC",
    holding_type: "spot",
    side: "long",
    value_usd: 100,
    api_key_id: K1,
    updated_at: "2026-07-01T10:00:00Z",
    ...overrides,
  };
}

function keyRow(id: string, overrides: Partial<KeyRow> = {}): KeyRow {
  return {
    id,
    exchange: "binance",
    venue_account_id: null,
    account_share_kind: null,
    account_shared_with_api_key_id: null,
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
  keysResolver.rows = [keyRow(K1)];
  keysResolver.error = null;
  keysResolver.selectArg = "";
  keysResolver.eqCalls = [];
  keysResolver.limitCalls = [];
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

describe("the series reads' shared fetch (owner gate and projection, T-98-07 / T-98-08)", () => {
  // These two cases used to run against the retired latest-snapshot read. Both
  // series go through the same `fetchHoldings`, so the trust boundary is pinned
  // here on the reads that remain.
  it("owner gate: issues .eq('allocator_id', userId) and a 730-day .gte('asof') cap", async () => {
    holdingsResolver.rows = [row()];
    await getNetExposureSeries(USER_ID);
    expect(holdingsResolver.eqCalls).toContainEqual(["allocator_id", USER_ID]);
    const gteCols = holdingsResolver.gteCalls.map((c) => c[0]);
    expect(gteCols).toContain("asof");
  });

  it("secretless projection (T-98-08): the holdings select is EXACTLY the eight allow-listed columns", async () => {
    holdingsResolver.rows = [row()];
    await getAllocationSeries(USER_ID);
    // Tightened by plan 14 (D-11), deliberately. Plan 09's per-key index and
    // D-11 need `api_key_id` and `updated_at` on the projection, so the old
    // substring check (`not.toMatch(/api_key/)`) can no longer hold. A column
    // SET equality is stricter than it was: any extra column (the raw payload,
    // key material) fails, which a substring check on two names could not say.
    const columns = holdingsResolver.selectArg.split(",").map((c) => c.trim());
    expect(new Set(columns)).toEqual(
      new Set([
        "asof",
        "venue",
        "symbol",
        "holding_type",
        "side",
        "value_usd",
        "api_key_id",
        "updated_at",
      ]),
    );
    expect(columns).toHaveLength(8);
  });

  it("the key-identity read (T-170.4-40): the per-key reader's identity columns, owner-scoped, on the user client", async () => {
    holdingsResolver.rows = [row()];
    await getNetExposureSeries(USER_ID);
    const identityColumns = (selectArg: string) =>
      new Set(selectArg.split(",").map((c) => c.trim()));
    expect(identityColumns(keysResolver.selectArg)).toEqual(
      identityColumns(KEY_IDENTITY_COLUMNS),
    );
    // No key material rides along: none of the identity columns is a secret.
    expect(keysResolver.selectArg).not.toMatch(/secret|passphrase|encrypted|raw_payload/);
    expect(keysResolver.eqCalls).toContainEqual(["user_id", USER_ID]);
    // The holdings owner gate is unchanged by the second read.
    expect(holdingsResolver.eqCalls).toContainEqual(["allocator_id", USER_ID]);
  });
});

describe("D-11: one exchange account counts once per (day, holding_type) in both series", () => {
  // K1 and K2 read ONE okx account (the D-09 identity the per-key reader groups
  // by), so the two keys' same-day rows are one account's rows, not two.
  const sharedAccount = () => [
    keyRow(K1, { exchange: "okx", venue_account_id: "ACCT-1" }),
    keyRow(K2, { exchange: "okx", venue_account_id: "ACCT-1" }),
  ];

  it("a same-account pair holding the same position on one day counts ONCE in net, gross and the venue gross", async () => {
    keysResolver.rows = sharedAccount();
    holdingsResolver.rows = [
      row({ venue: "okx", api_key_id: K1, value_usd: 1000, updated_at: "2026-07-01T10:00:00Z" }),
      row({ venue: "okx", api_key_id: K2, value_usd: 1000, updated_at: "2026-07-01T11:00:00Z" }),
    ];

    const net = await getNetExposureSeries(USER_ID);
    expect(net.points).toEqual([{ asof: "2026-07-01", netUsd: 1000, grossUsd: 1000 }]);

    const alloc = await getAllocationSeries(USER_ID);
    expect(alloc.points).toEqual([
      { asof: "2026-07-01", venues: [{ venue: "okx", valueUsd: 1000, weight: 1 }] },
    ]);
  });

  it("the rule runs per asof day, never once over the window: the earlier day keeps its point (D-03)", async () => {
    keysResolver.rows = sharedAccount();
    holdingsResolver.rows = [
      row({ venue: "okx", api_key_id: K1, value_usd: 1000, updated_at: "2026-07-01T10:00:00Z" }),
      row({ venue: "okx", api_key_id: K2, value_usd: 1000, updated_at: "2026-07-01T11:00:00Z" }),
      row({ asof: "2026-07-02", venue: "okx", api_key_id: K1, value_usd: 1200, updated_at: "2026-07-02T10:00:00Z" }),
    ];

    const net = await getNetExposureSeries(USER_ID);
    expect(net.points).toEqual([
      { asof: "2026-07-01", netUsd: 1000, grossUsd: 1000 },
      { asof: "2026-07-02", netUsd: 1200, grossUsd: 1200 },
    ]);
    expect(net.gaps).toEqual([]);

    const alloc = await getAllocationSeries(USER_ID);
    expect(alloc.points.map((p) => p.asof)).toEqual(["2026-07-01", "2026-07-02"]);
    expect(alloc.gaps).toEqual([]);
  });

  it("keys on DISTINCT accounts both count (D-08): 300 + 200 = 500", async () => {
    keysResolver.rows = [
      keyRow(K3, { exchange: "binance", venue_account_id: "ACCT-2" }),
      keyRow(K4, { exchange: "binance", venue_account_id: "ACCT-3" }),
    ];
    holdingsResolver.rows = [
      row({ symbol: "ETH", api_key_id: K3, value_usd: 300 }),
      row({ symbol: "ETH", api_key_id: K4, value_usd: 200 }),
    ];

    const net = await getNetExposureSeries(USER_ID);
    expect(net.points).toEqual([{ asof: "2026-07-01", netUsd: 500, grossUsd: 500 }]);

    const alloc = await getAllocationSeries(USER_ID);
    expect(alloc.points).toEqual([
      { asof: "2026-07-01", venues: [{ venue: "binance", valueUsd: 500, weight: 1 }] },
    ]);
  });

  it("the winner is picked per holding_type: K2's later spot poll does not erase K1's only derivative", async () => {
    keysResolver.rows = sharedAccount();
    holdingsResolver.rows = [
      row({
        venue: "okx", api_key_id: K1, symbol: "BTC-PERP", holding_type: "derivative",
        side: "short", value_usd: 400, updated_at: "2026-07-01T09:00:00Z",
      }),
      row({ venue: "okx", api_key_id: K1, value_usd: 1000, updated_at: "2026-07-01T10:00:00Z" }),
      row({ venue: "okx", api_key_id: K2, value_usd: 1000, updated_at: "2026-07-01T11:00:00Z" }),
    ];

    const net = await getNetExposureSeries(USER_ID);
    // spot long 1000 (K2 wins spot) minus derivative short 400 (K1 is the only
    // derivative): net 600, gross 1400.
    expect(net.points).toEqual([{ asof: "2026-07-01", netUsd: 600, grossUsd: 1400 }]);
  });

  it("an identity read ERROR rejects both series (never an empty or partial series)", async () => {
    holdingsResolver.rows = [row()];
    keysResolver.error = { message: "api_keys read failed" };
    await expect(getNetExposureSeries(USER_ID)).rejects.toEqual({ message: "api_keys read failed" });
    await expect(getAllocationSeries(USER_ID)).rejects.toEqual({ message: "api_keys read failed" });
  });

  it("an identity read that REACHES the row cap rejects both series, naming the cap", async () => {
    holdingsResolver.rows = [row()];
    keysResolver.rows = Array.from({ length: 1000 }, (_, i) =>
      keyRow(`bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    await expect(getNetExposureSeries(USER_ID)).rejects.toThrow(/row cap \(1000\)/);
    await expect(getAllocationSeries(USER_ID)).rejects.toThrow(/row cap \(1000\)/);
  });

  it("an unparseable updated_at on a counted row rejects with HoldingsUpdatedAtError", async () => {
    holdingsResolver.rows = [row({ updated_at: "not-a-timestamp" })];
    await expect(getNetExposureSeries(USER_ID)).rejects.toMatchObject({
      name: "HoldingsUpdatedAtError",
    });
    await expect(getAllocationSeries(USER_ID)).rejects.toMatchObject({
      name: "HoldingsUpdatedAtError",
    });
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
