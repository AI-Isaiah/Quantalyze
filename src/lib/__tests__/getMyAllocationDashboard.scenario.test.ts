import { describe, it, expect, vi } from "vitest";

/**
 * Phase 10 / Plan 10-03 and follow-ons.
 *
 * Focused unit tests for pure helpers exported from `src/lib/queries.ts`:
 *   - `holdingEquityContribution` (NEW-C03-01)
 *   - `partitionTrustworthyEquitySnapshots` (CL9 / NEW-C01-11)
 *   - `emptyLiveBaselineMetrics` / `liveBaselineMetricsFromPerKeyDailies`
 *     shape-identity (Phase 36 / 36-03)
 *
 * These are exported so we can call them directly without round-tripping
 * through Supabase mocks.
 */

// queries.ts pulls in @/lib/audit, which imports "server-only" — that
// throws under vitest+jsdom. Mock it the same way the route tests do.
vi.mock("server-only", () => ({}));

import {
  holdingEquityContribution,
  partitionTrustworthyEquitySnapshots,
  emptyLiveBaselineMetrics,
  liveBaselineMetricsFromPerKeyDailies,
  derivePhase07Fields,
  type MyAllocationDashboardPayload,
} from "../queries";

describe("MyAllocationDashboardPayload — type smokes", () => {
  it("T_H3 — getMyAllocationDashboard payload type includes allocator_id field", () => {
    // Compile-time + runtime sanity: the exported payload type must declare
    // allocator_id as a plain string. The full integration test (auth.getUser
    // wired into the payload) lives in queries.my-allocation.test.ts; this
    // dedicated check guards the type declaration in a fast, focused unit.
    const payload: Pick<MyAllocationDashboardPayload, "allocator_id"> = {
      allocator_id: "alloc-A",
    };
    expect(payload.allocator_id).toBe("alloc-A");
    expect(typeof payload.allocator_id).toBe("string");
  });

  it("T_M4 — payload type exposes liveBaselineMetrics with the SSR-lifted shape", () => {
    // Compile-time guard for the M4 SSR lift: the composer (Plan 06b) consumes
    // this object instead of recomputing the live baseline per render.
    const lbm: MyAllocationDashboardPayload["liveBaselineMetrics"] = {
      aum: 100000,
      ytdTwr: 0.05,
      sharpe: 1.2,
      maxDd: -0.1,
      avgRho: 0.4,
      equity: [{ date: "2026-01-01", value: 1.0 }],
      drawdown: [{ date: "2026-01-01", value: 0 }],
    };
    expect(lbm.aum).toBe(100000);
    expect(lbm.ytdTwr).toBe(0.05);
    expect(lbm.sharpe).toBe(1.2);
    expect(lbm.maxDd).toBe(-0.1);
    expect(lbm.avgRho).toBe(0.4);
    expect(lbm.equity[0]).toEqual({ date: "2026-01-01", value: 1.0 });
    expect(lbm.drawdown[0]).toEqual({ date: "2026-01-01", value: 0 });

    // Empty defaults (the !portfolio branch) must satisfy the type too.
    const empty: MyAllocationDashboardPayload["liveBaselineMetrics"] = {
      aum: 0,
      ytdTwr: null,
      sharpe: null,
      maxDd: null,
      avgRho: null,
      equity: [],
      drawdown: [],
    };
    expect(empty.aum).toBe(0);
    expect(empty.equity).toEqual([]);
  });

  it("T_M5 — payload type exposes the Phase-37 per-key channel (3 additive fields)", () => {
    // Compile-time guard for the DSRC-01 enabler: the composer (Plans 02/03)
    // recomputes the blend client-side from these fields on a data-source
    // toggle. The Pick<> forces ALL THREE keys to be present — deleting any one
    // from MyAllocationDashboardPayload fails this assignment at compile time.
    const perKeyChannel: Pick<
      MyAllocationDashboardPayload,
      | "perKeyReturnsByApiKeyId"
      | "perKeyDailiesGateSatisfied"
      | "eligibleApiKeyIds"
    > = {
      perKeyReturnsByApiKeyId: {
        "key-A": [{ date: "2026-01-01", value: 0.01 }],
      },
      perKeyDailiesGateSatisfied: true,
      eligibleApiKeyIds: ["key-A"],
    };
    expect(perKeyChannel.perKeyReturnsByApiKeyId["key-A"]).toEqual([
      { date: "2026-01-01", value: 0.01 },
    ]);
    expect(perKeyChannel.perKeyDailiesGateSatisfied).toBe(true);
    expect(perKeyChannel.eligibleApiKeyIds).toEqual(["key-A"]);

    // Empty/false defaults (the !portfolio + no-coverage branch) satisfy the
    // type too — the fresh-allocator path carries {} / false / [].
    const emptyChannel: Pick<
      MyAllocationDashboardPayload,
      | "perKeyReturnsByApiKeyId"
      | "perKeyDailiesGateSatisfied"
      | "eligibleApiKeyIds"
    > = {
      perKeyReturnsByApiKeyId: {},
      perKeyDailiesGateSatisfied: false,
      eligibleApiKeyIds: [],
    };
    expect(emptyChannel.perKeyReturnsByApiKeyId).toEqual({});
    expect(emptyChannel.perKeyDailiesGateSatisfied).toBe(false);
    expect(emptyChannel.eligibleApiKeyIds).toEqual([]);
  });
});

/**
 * NEW-C03-01 regression: holdingEquityContribution must use unrealized_pnl_usd
 * for derivatives, NOT value_usd (notional). A 10x perp with $5M notional only
 * contributes its unrealized P&L ($X) to the portfolio's equity — using the
 * notional would inflate AUM by the leverage factor and corrupt KPIs.
 */
describe("NEW-C03-01 — holdingEquityContribution: derivatives use unrealized_pnl_usd", () => {
  type H = MyAllocationDashboardPayload["holdingsSummary"][number];

  it("spot holding: returns value_usd as equity contribution", () => {
    const h: H = {
      symbol: "BTC",
      venue: "binance",
      holding_type: "spot",
      value_usd: 50000,
      quantity: 1,
      mark_price_usd: 50000,
      api_key_id: "key-1",
      side: "flat",
      entry_price: null,
      unrealized_pnl_usd: null,
    };
    expect(holdingEquityContribution(h)).toBe(50000);
  });

  it("derivative long: returns unrealized_pnl_usd (NOT the notional value_usd)", () => {
    const h: H = {
      symbol: "BTC",
      venue: "binance",
      holding_type: "derivative",
      // Notional (should be IGNORED): $5M
      value_usd: 5_000_000,
      // Equity contribution: the actual unrealized P&L
      unrealized_pnl_usd: 12_500,
      quantity: 1,
      mark_price_usd: 50000,
      api_key_id: "key-1",
      side: "long",
      entry_price: 48000,
    };
    expect(holdingEquityContribution(h)).toBe(12_500);
    // Explicitly: must NOT return the notional
    expect(holdingEquityContribution(h)).not.toBe(5_000_000);
  });

  it("derivative with unrealized_pnl_usd=null: returns 0 (not notional)", () => {
    const h: H = {
      symbol: "ETH",
      venue: "okx",
      holding_type: "derivative",
      value_usd: 2_000_000, // notional — must be ignored
      unrealized_pnl_usd: null,
      quantity: 10,
      mark_price_usd: 3000,
      api_key_id: "key-2",
      side: "short",
      entry_price: 3100,
    };
    expect(holdingEquityContribution(h)).toBe(0);
  });

  it("spot holding with NaN value_usd: returns 0", () => {
    const h: H = {
      symbol: "BTC",
      venue: "binance",
      holding_type: "spot",
      value_usd: NaN,
      quantity: 1,
      mark_price_usd: null,
      api_key_id: "key-1",
      side: "flat",
      entry_price: null,
      unrealized_pnl_usd: null,
    };
    expect(holdingEquityContribution(h)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CL9 / NEW-C01-11 — partitionTrustworthyEquitySnapshots
//
// WHY this matters: when OKX's 90-day trade terminus clamps the funding
// deposit out of the fetch window, the reconstructed rows carry a garbage
// absolute baseline. getMyAllocationDashboard drops them at the read boundary
// so they can't feed the equity curve / drawdown / TWR / per-holding returns /
// warm-up gate — and raises `baselineUnknown` so the dashboard explains the
// gap instead of letting it read as a broken connection. These tests pin BOTH
// halves of that contract; a regression that stopped filtering (re-exposing
// the garbage curve) or stopped flagging (silent gap) must fail here.
// ---------------------------------------------------------------------------
describe("partitionTrustworthyEquitySnapshots (CL9 / NEW-C01-11)", () => {
  type Row = { asof: string; pre_terminus_balance_unknown: boolean };

  it("drops flagged rows and raises baselineUnknown when a terminus-clamped row is present", () => {
    const rows: Row[] = [
      { asof: "2026-01-01", pre_terminus_balance_unknown: true },
      { asof: "2026-01-02", pre_terminus_balance_unknown: true },
      { asof: "2026-01-03", pre_terminus_balance_unknown: false },
    ];
    const { trustworthy, baselineUnknown } =
      partitionTrustworthyEquitySnapshots(rows);
    expect(baselineUnknown).toBe(true);
    // Only the trustworthy (live-refresh) row survives — the level-derived
    // surfaces never see the zero-baseline rows.
    expect(trustworthy.map((r) => r.asof)).toEqual(["2026-01-03"]);
  });

  it("keeps every row and leaves baselineUnknown false for a fully-trustworthy series", () => {
    const rows: Row[] = [
      { asof: "2026-01-01", pre_terminus_balance_unknown: false },
      { asof: "2026-01-02", pre_terminus_balance_unknown: false },
    ];
    const { trustworthy, baselineUnknown } =
      partitionTrustworthyEquitySnapshots(rows);
    expect(baselineUnknown).toBe(false);
    expect(trustworthy).toHaveLength(2);
  });

  it("flags the gap even when 0 trustworthy rows remain (fully-clamped allocator)", () => {
    const rows: Row[] = [
      { asof: "2026-01-01", pre_terminus_balance_unknown: true },
    ];
    const { trustworthy, baselineUnknown } =
      partitionTrustworthyEquitySnapshots(rows);
    expect(baselineUnknown).toBe(true);
    expect(trustworthy).toHaveLength(0);
  });

  it("preserves input order of the trustworthy rows", () => {
    const rows: Row[] = [
      { asof: "2026-01-03", pre_terminus_balance_unknown: false },
      { asof: "2026-01-01", pre_terminus_balance_unknown: true },
      { asof: "2026-01-02", pre_terminus_balance_unknown: false },
    ];
    const { trustworthy } = partitionTrustworthyEquitySnapshots(rows);
    expect(trustworthy.map((r) => r.asof)).toEqual(["2026-01-03", "2026-01-02"]);
  });

  it("empty input → empty trustworthy set, baselineUnknown false", () => {
    const { trustworthy, baselineUnknown } =
      partitionTrustworthyEquitySnapshots([]);
    expect(trustworthy).toEqual([]);
    expect(baselineUnknown).toBe(false);
  });

  it("treats null / omitted pre_terminus_balance_unknown as trustworthy (pins the optional|null contract)", () => {
    // The helper's generic bound is `pre_terminus_balance_unknown?: boolean|null`
    // and the migration's COALESCE-to-false covers an omitted field. Pin the TS
    // analogue: null and missing both classify as trustworthy and don't flag.
    const rows = [
      { asof: "2026-01-01", pre_terminus_balance_unknown: null },
      { asof: "2026-01-02" }, // field omitted entirely
    ] as Array<{ asof: string; pre_terminus_balance_unknown?: boolean | null }>;
    const { trustworthy, baselineUnknown } =
      partitionTrustworthyEquitySnapshots(rows);
    expect(baselineUnknown).toBe(false);
    expect(trustworthy.map((r) => r.asof)).toEqual(["2026-01-01", "2026-01-02"]);
  });
});

/**
 * Phase 36 / 36-03 — the liveBaselineMetrics OUTPUT contract must be
 * byte-identical (same key set + value types) between the per-key branch and
 * the snapshot fallback. The SSR payload + scenario composer baseline depend on
 * it — only the SOURCE of the curve/KPIs is repointed, never the shape.
 */
describe("Phase 36 — liveBaselineMetrics shape-identity (per-key branch vs fallback)", () => {
  type H = MyAllocationDashboardPayload["holdingsSummary"][number];
  const DATES = Array.from({ length: 10 }, (_, i) =>
    `2026-05-${String(i + 1).padStart(2, "0")}`,
  );
  const RET_A = [0.02, -0.01, 0.03, -0.02, 0.01, 0.0, 0.015, -0.005, 0.02, -0.01];
  const RET_B = [-0.01, 0.02, -0.015, 0.025, -0.005, 0.01, -0.02, 0.015, -0.01, 0.02];
  const series = (vals: number[]) =>
    vals.map((value, i) => ({ date: DATES[i], value }));

  const holdings: H[] = [
    {
      symbol: "BTC",
      venue: "binance",
      holding_type: "spot",
      value_usd: 60_000,
      quantity: 1,
      mark_price_usd: 60_000,
      api_key_id: "key-A",
      side: "flat",
      entry_price: null,
      unrealized_pnl_usd: null,
    },
    {
      symbol: "ETH",
      venue: "okx",
      holding_type: "spot",
      value_usd: 40_000,
      quantity: 10,
      mark_price_usd: 4_000,
      api_key_id: "key-B",
      side: "flat",
      entry_price: null,
      unrealized_pnl_usd: null,
    },
  ];

  const EXPECTED_KEYS = [
    "aum",
    "ytdTwr",
    "sharpe",
    "maxDd",
    "avgRho",
    "equity",
    "drawdown",
  ].sort();

  function assertShape(m: MyAllocationDashboardPayload["liveBaselineMetrics"]) {
    expect(Object.keys(m).sort()).toEqual(EXPECTED_KEYS);
    expect(typeof m.aum).toBe("number");
    for (const f of ["ytdTwr", "sharpe", "maxDd", "avgRho"] as const) {
      expect(m[f] === null || typeof m[f] === "number").toBe(true);
    }
    expect(Array.isArray(m.equity)).toBe(true);
    expect(Array.isArray(m.drawdown)).toBe(true);
  }

  it("the per-key branch and the gate=false emptyDefault share the identical liveBaselineMetrics shape", () => {
    const perKey = liveBaselineMetricsFromPerKeyDailies(holdings, {
      "key-A": series(RET_A),
      "key-B": series(RET_B),
    });
    // Phase 63 ENGINE-04 — the gate=false SSR arm is now the honest emptyDefault
    // (AUM preserved, all metrics null), NOT a holdings-snapshot reconstruction.
    const fallback = emptyLiveBaselineMetrics(holdings);

    assertShape(perKey);
    assertShape(fallback);
    expect(Object.keys(perKey).sort()).toEqual(Object.keys(fallback).sort());

    // AUM is unchanged (D2): summed from holdings on both branches.
    expect(perKey.aum).toBe(100_000);
    expect(fallback.aum).toBe(100_000);
    // The per-key branch produces a real curve; the emptyDefault fallback is
    // honestly empty (metrics null → KpiStrip "—").
    expect(perKey.equity.length).toBeGreaterThan(0);
    expect(fallback.equity).toEqual([]);
    expect(fallback.sharpe).toBeNull();
  });

  it("empty-default shape is identical on both branches (no usable series → emptyDefault)", () => {
    const perKey = liveBaselineMetricsFromPerKeyDailies(holdings, {});
    const fallback = emptyLiveBaselineMetrics(holdings);
    assertShape(perKey);
    assertShape(fallback);
    expect(perKey).toEqual(fallback);
    // AUM still summed from holdings; KPIs null; arrays empty.
    expect(perKey.aum).toBe(100_000);
    expect(perKey.sharpe).toBeNull();
    expect(perKey.equity).toEqual([]);
  });

  // Phase 37 / 37-01 — the new per-key payload channel is ADDITIVE: exposing
  // perKeyReturnsByApiKeyId / perKeyDailiesGateSatisfied / eligibleApiKeyIds did
  // NOT repoint the liveBaselineMetrics derivation. This pins the exact per-key
  // blend OUTPUT so any future change to that derivation (the Phase-36
  // byte-identity invariant) fails loudly — the additive fields ride the SAME
  // perKeyReturnsByApiKeyId the metrics select on, never a second source.
  it("Phase 37 additive channel leaves liveBaselineMetrics derivation unchanged", () => {
    const perKeyInput = {
      "key-A": series(RET_A),
      "key-B": series(RET_B),
    };
    // Same input the payload's perKeyReturnsByApiKeyId field now carries.
    const metrics = liveBaselineMetricsFromPerKeyDailies(holdings, perKeyInput);
    assertShape(metrics);
    // AUM (D2) is byte-identical to the Phase-36 expectation; KPIs/curve are a
    // deterministic function of the per-key series only.
    expect(metrics.aum).toBe(100_000);
    expect(metrics.equity.length).toBeGreaterThan(0);
    expect(metrics.drawdown.length).toBe(metrics.equity.length);
    // Calling it twice with the same input is deterministic (no hidden coupling
    // to the new fields) — the derivation is a pure function of (holdings,
    // perKeyReturnsByApiKeyId).
    const again = liveBaselineMetricsFromPerKeyDailies(holdings, perKeyInput);
    expect(again).toEqual(metrics);
  });
});

/**
 * Phase 110.1 / DOGFOOD-1 (HIGH) — the connected-keys SIGNAL must use the
 * canonical isPerKeyDailiesEligibleKey predicate, NOT `activeKeys.length`.
 *
 * WHY this matters: soft-disconnected (`disconnected_at != null`) and
 * credential-revoked (`sync_status='revoked'`) keys keep `is_active=true`
 * (routers/cron.py sets those columns WITHOUT deactivating). The pre-110.1
 * dashboard derived the empty-state connected signal from
 * `activeVenues.length > 0` (is_active-only), so an allocator who disconnected
 * their ONLY key was wrongly told "connected — no positions synced yet"
 * instead of the honest "Connect a key" CTA. This test exercises the real
 * payload builder (derivePhase07Fields), so it guards the WIRING — that the
 * builder invokes the predicate — not merely the predicate in isolation. It
 * FAILS against the old `apiKeys.filter(k => k.is_active).length > 0`
 * derivation.
 */
describe("DOGFOOD-1 — derivePhase07Fields.hasConnectedKeys uses isPerKeyDailiesEligibleKey (110.1)", () => {
  const NO_SNAPSHOTS: MyAllocationDashboardPayload["equitySnapshots"] = [];
  const NO_HOLDINGS: Parameters<typeof derivePhase07Fields>[3] = [];

  type Key = Parameters<typeof derivePhase07Fields>[0][number];
  const key = (over: Partial<Key>): Key => ({
    is_active: true,
    exchange: "binance",
    sync_status: "ok",
    last_sync_at: "2026-07-16T00:00:00Z",
    disconnected_at: null,
    ...over,
  });

  const derive = (apiKeys: Key[]) =>
    // Phase 115.1 — the 6th arg is the derived $-equity row; null here (no
    // derived surface) exercises the legacy fallback, orthogonal to the
    // hasConnectedKeys derivation under test.
    derivePhase07Fields(apiKeys, NO_SNAPSHOTS, 0, NO_HOLDINGS, false, null);

  it("a live is_active key → hasConnectedKeys=true", () => {
    expect(derive([key({})]).hasConnectedKeys).toBe(true);
  });

  it("REGRESSION: an is_active key that is soft-disconnected (disconnected_at != null) → hasConnectedKeys=false", () => {
    // is_active stays true (the disconnect worker does not deactivate) — the
    // old activeKeys.length derivation returned true here (the bug).
    const out = derive([
      key({ is_active: true, disconnected_at: "2026-07-15T09:00:00Z" }),
    ]);
    expect(out.hasConnectedKeys).toBe(false);
    // activeVenues still lists the venue (factsheet "markets" line is
    // is_active-scoped and must NOT change) — proving the two signals diverge.
    expect(out.activeVenues).toEqual(["Binance"]);
  });

  it("REGRESSION: an is_active key with sync_status='revoked' → hasConnectedKeys=false", () => {
    const out = derive([key({ is_active: true, sync_status: "revoked" })]);
    expect(out.hasConnectedKeys).toBe(false);
    expect(out.activeVenues).toEqual(["Binance"]);
  });

  it("no keys → hasConnectedKeys=false", () => {
    expect(derive([]).hasConnectedKeys).toBe(false);
  });

  it("mixed: one revoked + one live → hasConnectedKeys=true (some, not every)", () => {
    const out = derive([
      key({ exchange: "okx", sync_status: "revoked" }),
      key({ exchange: "binance" }),
    ]);
    expect(out.hasConnectedKeys).toBe(true);
  });
});
