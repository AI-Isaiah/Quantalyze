/**
 * Phase 170.6.1 / DISCOVERYPHONE (SC-2, D-04, D-06) — the Discovery list reads
 * the venue each strategy's trades come from through ONE batched call to the
 * published-only `get_published_trade_venues` SECURITY DEFINER function (plan 01).
 *
 * THE DEFECT (measured 2026-10-13 by TRADESYNC plan 21, anon curl on PROD): a
 * row read "Bybit" from `strategies.supported_exchanges` while its connected key
 * sits on OKX. The list had no way to know the key's exchange, because anon
 * cannot read `api_keys` and the function above is the only door.
 *
 * What these cases defend, and why each can fail:
 *   1. the reader is called ONCE for the whole list, with every row id, on the
 *      request client (the mock exposes no service-role path at all);
 *   2. each row carries its OWN distinct lowercase venues, and a row with none
 *      carries none (a CSV or demo strategy keeps its listed exchange);
 *   3. an RPC failure is loud (`console.error` naming the RPC, Sentry at
 *      `error`) and fail-soft (rows still return, trust tiers intact, no
 *      venues), because the page rendering matters more than the label;
 *   4. D-06: `getMyStrategies` never calls the function.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ID_A = "70610001-0000-4000-8000-00000000000a";
const ID_B = "70610001-0000-4000-8000-00000000000b";

const rec = vi.hoisted(() => ({
  rows: [] as unknown[],
  rpcCalls: [] as [string, Record<string, unknown>][],
  venueResponse: { data: [] as unknown, error: null as unknown },
  trustResponse: { data: [] as unknown, error: null as unknown },
  sentry: [] as { err: unknown; opts: unknown }[],
  adminCreated: 0,
  rpcThrow: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "in", "neq"]) {
        chain[m] = () => chain;
      }
      chain.then = (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
      ) => Promise.resolve({ data: rec.rows, error: null }).then(onFulfilled);
      return chain;
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      rec.rpcCalls.push([name, params]);
      if (name === "get_published_trade_venues" && rec.rpcThrow) {
        throw rec.rpcThrow;
      }
      if (name === "get_published_trade_venues") {
        return Promise.resolve(rec.venueResponse);
      }
      return Promise.resolve(rec.trustResponse);
    },
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    rec.adminCreated += 1;
    return { from: () => ({}) };
  },
}));

vi.mock("@/lib/sentry-capture", () => ({
  captureToSentry: (err: unknown, opts: unknown) => {
    rec.sentry.push({ err, opts });
  },
}));

import { getStrategiesByCategory, getMyStrategies } from "./queries";

function venueCalls() {
  return rec.rpcCalls.filter(([n]) => n === "get_published_trade_venues");
}

beforeEach(() => {
  rec.rows = [
    { id: ID_A, strategy_analytics: null },
    { id: ID_B, strategy_analytics: null },
  ];
  rec.rpcCalls = [];
  rec.venueResponse = { data: [], error: null };
  rec.trustResponse = { data: [], error: null };
  rec.sentry = [];
  rec.adminCreated = 0;
  rec.rpcThrow = null;
  vi.restoreAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getStrategiesByCategory - the venue read (SC-2, D-04)", () => {
  it("calls get_published_trade_venues ONCE with every row id and attaches the venue to its own row", async () => {
    rec.venueResponse = {
      data: [{ strategy_id: ID_A, exchange: "okx" }],
      error: null,
    };

    const rows = await getStrategiesByCategory("crypto-sma");

    const calls = venueCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ p_strategy_ids: [ID_A, ID_B] });

    const a = rows.find((r) => r.id === ID_A)!;
    const b = rows.find((r) => r.id === ID_B)!;
    expect(a.tradeVenues).toEqual(["okx"]);
    // A strategy with no key (CSV or demo) carries no venues at all, so its
    // listed exchange stays the label (D-05).
    expect(b.tradeVenues).toBeUndefined();
  });

  it("groups several rows per strategy, lowercased and distinct", async () => {
    rec.venueResponse = {
      data: [
        { strategy_id: ID_A, exchange: "OKX" },
        { strategy_id: ID_A, exchange: "bybit" },
        { strategy_id: ID_A, exchange: "okx" },
      ],
      error: null,
    };

    const rows = await getStrategiesByCategory("crypto-sma");

    const a = rows.find((r) => r.id === ID_A)!;
    expect([...(a.tradeVenues ?? [])].sort()).toEqual(["bybit", "okx"]);
  });

  it("never builds a service-role client for the venue read (T-170.6.1-15)", async () => {
    rec.venueResponse = {
      data: [{ strategy_id: ID_A, exchange: "okx" }],
      error: null,
    };
    await getStrategiesByCategory("crypto-sma");
    expect(rec.adminCreated).toBe(0);
  });

  it("an RPC failure is loud, fail-soft, and leaves every row on its listed exchange (T-170.6.1-17)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpcError = { code: "42883", message: "function does not exist" };
    rec.venueResponse = { data: null, error: rpcError };
    rec.trustResponse = {
      data: [{ strategy_id: ID_A, trust_tier: "api_verified", status: "verified" }],
      error: null,
    };

    const rows = await getStrategiesByCategory("crypto-sma");

    // The page still renders: both rows come back, with their trust tier.
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === ID_A)!.trust_tier).toBe("api_verified");
    for (const r of rows) {
      expect(r.tradeVenues).toBeUndefined();
      // WR-01: the failure is carried to the row, so the badge shows no venue
      // label instead of the listed exchange.
      expect(r.tradeVenuesUnavailable).toBe(true);
    }

    const venueLogs = consoleError.mock.calls.filter((c) =>
      String(c[0]).includes("get_published_trade_venues"),
    );
    expect(venueLogs).toHaveLength(1);
    const venueSentry = rec.sentry.filter(
      (s) => (s.opts as { tags?: { op?: string } }).tags?.op === "readPublishedTradeVenues",
    );
    expect(venueSentry).toHaveLength(1);
    expect((venueSentry[0].opts as { level?: string }).level).toBe("error");
    expect(venueSentry[0].err).toBe(rpcError);
  });
});

describe("getStrategiesByCategory - a failed or malformed venue read is UNAVAILABLE, not empty (review WR-01, SFH-1, SFH-2)", () => {
  function venueSentry() {
    return rec.sentry.filter(
      (s) => (s.opts as { tags?: { op?: string } }).tags?.op === "readPublishedTradeVenues",
    );
  }
  function venueLogs(consoleError: { mock: { calls: unknown[][] } }) {
    return consoleError.mock.calls.filter((c) =>
      String(c[0]).includes("get_published_trade_venues"),
    );
  }

  it("an RPC that THROWS marks every row unavailable, logs and captures once, and the page still renders", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = new Error("socket hang up");
    rec.rpcThrow = boom;

    const rows = await getStrategiesByCategory("crypto-sma");

    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.tradeVenues).toBeUndefined();
      expect(r.tradeVenuesUnavailable).toBe(true);
    }
    expect(venueLogs(consoleError)).toHaveLength(1);
    expect(venueSentry()).toHaveLength(1);
    expect(venueSentry()[0].err).toBe(boom);
  });

  it("D-10 keeps WR-01: each failed call captures to Sentry exactly ONCE, so two calls capture twice and never once per row", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpcError = { code: "42883", message: "function does not exist" };
    rec.venueResponse = { data: null, error: rpcError };

    // Each call returns TWO rows. A per-row capture would make 2 + 2 = 4; a
    // dropped capture would make 0; a cross-call dedupe would make 1.
    const first = await getStrategiesByCategory("crypto-sma");
    expect(first).toHaveLength(2);
    expect(venueSentry()).toHaveLength(1);
    const second = await getStrategiesByCategory("crypto-sma");
    expect(second).toHaveLength(2);

    for (const r of [...first, ...second]) {
      expect(r.tradeVenues).toBeUndefined();
      expect(r.tradeVenuesUnavailable).toBe(true);
    }
    expect(venueSentry()).toHaveLength(2);
    for (const s of venueSentry()) {
      expect((s.opts as { level?: string }).level).toBe("error");
      expect(s.err).toBe(rpcError);
    }
    expect(venueLogs(consoleError)).toHaveLength(2);
  });

  it("a non-array payload is captured ONCE and marks every row unavailable", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rec.venueResponse = { data: { strategy_id: ID_A, exchange: "okx" }, error: null };

    const rows = await getStrategiesByCategory("crypto-sma");

    for (const r of rows) {
      expect(r.tradeVenues).toBeUndefined();
      expect(r.tradeVenuesUnavailable).toBe(true);
    }
    expect(venueLogs(consoleError)).toHaveLength(1);
    expect(venueSentry()).toHaveLength(1);
    expect((venueSentry()[0].opts as { level?: string }).level).toBe("error");
  });

  it("one row missing its exchange is captured ONCE; the other rows still carry their venue and stay available", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rec.venueResponse = {
      data: [
        { strategy_id: ID_A, exchange: "okx" },
        { strategy_id: ID_B, exchange: null },
        { strategy_id: ID_B },
      ],
      error: null,
    };

    const rows = await getStrategiesByCategory("crypto-sma");

    const a = rows.find((r) => r.id === ID_A)!;
    expect(a.tradeVenues).toEqual(["okx"]);
    expect(a.tradeVenuesUnavailable).toBeUndefined();
    expect(venueLogs(consoleError)).toHaveLength(1);
    expect(venueSentry()).toHaveLength(1);
    expect((venueSentry()[0].opts as { extra?: { droppedRows?: number } }).extra?.droppedRows).toBe(2);
  });

  it("rows that ALL fail the shape check (a renamed column) make the whole payload unavailable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    rec.venueResponse = {
      data: [{ strategy_id: ID_A, venue: "okx" }, { strategy_id: ID_B, venue: "bybit" }],
      error: null,
    };

    const rows = await getStrategiesByCategory("crypto-sma");

    for (const r of rows) expect(r.tradeVenuesUnavailable).toBe(true);
    expect(venueSentry()).toHaveLength(1);
  });

  it("a successful read that finds no key is NOT unavailable and raises no alarm (CSV and demo keep their listed exchange, D-05)", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    rec.venueResponse = { data: [], error: null };

    const rows = await getStrategiesByCategory("crypto-sma");

    for (const r of rows) {
      expect(r.tradeVenues).toBeUndefined();
      expect(r.tradeVenuesUnavailable).toBeUndefined();
    }
    expect(venueLogs(consoleError)).toHaveLength(0);
    expect(venueSentry()).toHaveLength(0);
  });
});

describe("getMyStrategies - D-06: the owner list is out of scope", () => {
  it("never calls get_published_trade_venues and attaches no venues", async () => {
    rec.rows = [{ id: ID_A, strategy_analytics: null }];
    rec.venueResponse = {
      data: [{ strategy_id: ID_A, exchange: "okx" }],
      error: null,
    };

    const rows = await getMyStrategies("u-1");

    expect(venueCalls()).toHaveLength(0);
    for (const r of rows ?? []) expect(r.tradeVenues).toBeUndefined();
  });
});

describe("D-06 scope: the four out-of-scope SyncBadge mounts do not name the venue", () => {
  /**
   * Source-reading on purpose: these files mount <SyncBadge> deep inside
   * components that need a full page to render, and the contract is the PROPS
   * they pass. Measured 2026-10-14, the reason each stays untouched:
   * CompositionDonut, StrategyBreakdownTable and /recommendations render no
   * venue label today (they pass no `exchange`), and StrategyHeader passes
   * `exchange` but its badge renders nothing (null stamp, null series end) and
   * no page mounts the component. This pin holds until
   * `[170.6.1-SYNCBADGE-OTHER-MOUNTS]` decides whether they should name the
   * venue; at that point this test is edited WITH that decision, not around it.
   */
  const MOUNTS = [
    "src/components/strategy/StrategyHeader.tsx",
    "src/components/portfolio/CompositionDonut.tsx",
    "src/components/portfolio/StrategyBreakdownTable.tsx",
    "src/app/(dashboard)/recommendations/page.tsx",
  ];

  for (const rel of MOUNTS) {
    it(`${rel} mounts SyncBadge and passes neither tradeVenues nor listedExchanges`, () => {
      const src = readFileSync(resolve(process.cwd(), rel), "utf8");
      // Control: the file really does mount the badge, so absence below is not
      // a read of the wrong file.
      expect(src).toMatch(/<SyncBadge\b/);
      expect(src).not.toMatch(/\btradeVenues\b/);
      expect(src).not.toMatch(/\blistedExchanges\b/);
    });
  }
});
