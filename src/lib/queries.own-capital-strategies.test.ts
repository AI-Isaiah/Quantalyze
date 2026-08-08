/**
 * Phase 150 review WR-01 — `getOwnCapitalStrategies` must RESOLVE the series,
 * not merely select it.
 *
 * WHY THIS MATTERS (the economics, not the implementation): a strategy's track
 * lives in ONE of two `strategy_analytics` columns and which one depends on the
 * ingest path. CSV ingest writes `daily_returns`. The analytics-service — every
 * API-key strategy, which is the ONLY kind the phase-150 capital question is
 * asked about, because it is asked at key-add — writes the cumprod WEALTH curve
 * to `returns_series` and leaves `daily_returns` NULL (phase-147's contract,
 * `phase-147-series-resolution-guards.test.ts`). The Holdings STRATEGIES panel
 * renders MTD from `strategy_analytics.daily_returns`, so a query that returns
 * the raw row renders "—" for a strategy that HAS a full track: a false claim
 * about the owner's own money surface.
 *
 * The falsifier is the WIRING, not the resolver: `resolveDailyReturnSeries` has
 * its own unit tests and was always green here — the defect was that the query
 * selected `returns_series` (satisfying the phase-147 grep) and then dropped it
 * on the floor. So these cases run the REAL query through the REAL row adapter
 * and assert the number a human reads off the table. Deleting the `.map(...)`
 * resolution in `getOwnCapitalStrategies` turns case 1's MTD back to `null`
 * (measured RED before the fix); no assertion here can pass on the resolver
 * alone.
 */

import { describe, it, expect, vi } from "vitest";

// queries.ts pulls in @/lib/supabase/admin which imports `server-only`, which
// throws on any non-server-component module load (vitest runs in jsdom). Stub
// the admin client entirely; the server client is the one under test and is
// driven per-case by `queryResult` below. Mirrors queries.my-strategies.test.ts:35-48.
const state = vi.hoisted(() => ({
  queryResult: { data: null as unknown, error: null as unknown },
}));

/**
 * Minimal PostgREST builder: `.select(...).eq(...).eq(...).neq(...)` and then
 * awaited. Every filter returns the same thenable, so the shape of the chain in
 * queries.ts can change without this mock lying about the result.
 */
function builder() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(state.queryResult).then(resolve),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => builder() }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => builder() }),
}));

import { getOwnCapitalStrategies } from "./queries";
import { toStrategyRows } from "@/app/(dashboard)/allocations/lib/strategies-row-adapter";

const USER = "00000000-0000-4000-8000-0000000000aa";

/**
 * An API-ingested analytics row: `daily_returns` NULL, the real track in
 * `returns_series` as a cumprod wealth index. The 07-31 anchor is the previous
 * month's close, so month-to-date is exactly 105/100 − 1 = 5% — an oracle taken
 * from the ECONOMICS (wealth on the last observed day over wealth at month
 * end), never from the adapter's own compounding loop.
 */
const API_INGESTED_ROW = {
  id: "s-api",
  name: "Helios Basis",
  codename: null,
  disclosure_tier: "exploratory",
  status: "private",
  capital_ownership: "own_capital",
  strategy_analytics: {
    daily_returns: null,
    cagr: 0.4,
    sharpe: 1.8,
    volatility: 0.3,
    max_drawdown: -0.12,
    returns_series: [
      { date: "2026-07-31", value: 100 },
      { date: "2026-08-01", value: 101 },
      { date: "2026-08-04", value: 105 },
    ],
  },
};

describe("getOwnCapitalStrategies — WR-01 series resolution (API-ingested strategies)", () => {
  it("an API-ingested marked strategy renders a REAL MTD, not '—' (daily_returns NULL + returns_series populated)", async () => {
    state.queryResult = { data: [API_INGESTED_ROW], error: null };

    const marked = await getOwnCapitalStrategies(USER);
    expect(marked).not.toBeNull();

    // The number the allocator reads off the Holdings STRATEGIES panel.
    const rows = toStrategyRows({ strategies: marked!, positions: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0].mtd).toBeCloseTo(0.05, 10);
    // Pre-fix this was null — the whole finding.
    expect(rows[0].mtd).not.toBeNull();
  });

  it("E2: the series is REDUCED server-side to `mtd` and NO return history crosses the RSC boundary", async () => {
    // Review round 3 E2 — this payload is handed straight to a "use client"
    // tree (page.tsx → AllocationsTabs → HoldingsTabPanel), so every field on
    // it is serialized into the flight payload on first paint. The only
    // consumer of the series was `computeMtd`; a strategy that is ALSO
    // positioned shipped the same history twice, since `payload.strategies`
    // carries its own embed.
    state.queryResult = { data: [API_INGESTED_ROW], error: null };

    const marked = await getOwnCapitalStrategies(USER);
    const row = marked![0] as unknown as Record<string, unknown>;
    const analytics = row.strategy_analytics as unknown as Record<
      string,
      unknown
    >;

    // (1) The scalar is there, and it is the SAME economics the old
    // client-side reduction produced: wealth on the last observed day over
    // wealth at the previous month's close, 105/100 − 1 = 5%. Hand-computed
    // from the fixture; never read back off the resolver.
    expect(marked![0].mtd).toBeCloseTo(0.05, 10);

    // (2) NEITHER series column crosses — not the resolved one, not the raw
    // wealth index. This is the whole finding: pre-fix `daily_returns` was
    // emitted in full.
    expect(analytics).not.toHaveProperty("daily_returns");
    expect(analytics).not.toHaveProperty("returns_series");
    expect(row).not.toHaveProperty("daily_returns");
    expect(row).not.toHaveProperty("returns_series");

    // (3) Non-vacuity: the fixture really does carry a multi-point series that
    // COULD have been serialized, and the resolution really did run — a
    // fixture with no series would satisfy (2) for the wrong reason, and a
    // dropped resolution would leave `mtd` null (this is the API-ingested row,
    // whose `daily_returns` column is NULL).
    expect(API_INGESTED_ROW.strategy_analytics.returns_series).toHaveLength(3);
    expect(API_INGESTED_ROW.strategy_analytics.daily_returns).toBeNull();
    expect(marked![0].mtd).not.toBeNull();

    // (4) The sibling SCALAR columns still cross untouched.
    expect(analytics.sharpe).toBe(1.8);
    expect(analytics.max_drawdown).toBe(-0.12);
    expect(analytics.cagr).toBe(0.4);
    expect(analytics.volatility).toBe(0.3);
  });

  it("a CSV-ingested strategy (daily_returns populated, returns_series NULL) is unaffected — the direct column still wins", async () => {
    state.queryResult = {
      data: [
        {
          ...API_INGESTED_ROW,
          id: "s-csv",
          strategy_analytics: {
            ...API_INGESTED_ROW.strategy_analytics,
            // The nested year-keyed JSONB shape the CSV path writes.
            daily_returns: { "2026": { "2026-08-01": 0.01, "2026-08-04": 0.02 } },
            returns_series: null,
          },
        },
      ],
      error: null,
    };

    const marked = await getOwnCapitalStrategies(USER);
    const rows = toStrategyRows({ strategies: marked!, positions: [] });
    expect(rows[0].mtd).toBeCloseTo(1.01 * 1.02 - 1, 10);
  });

  it("a strategy with NO analytics row keeps a null MTD (absence stays absence — never a fabricated 0)", async () => {
    state.queryResult = {
      data: [{ ...API_INGESTED_ROW, id: "s-none", strategy_analytics: null }],
      error: null,
    };

    const marked = await getOwnCapitalStrategies(USER);
    expect(marked![0].strategy_analytics).toBeNull();
    const rows = toStrategyRows({ strategies: marked!, positions: [] });
    expect(rows[0].mtd).toBeNull();
  });

  it("a transient DB failure still returns null, never [] (the WR-02 error contract this map must not swallow)", async () => {
    state.queryResult = { data: null, error: { message: "boom" } };
    await expect(getOwnCapitalStrategies(USER)).resolves.toBeNull();
  });
});
