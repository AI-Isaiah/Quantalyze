/**
 * Phase 170.4 plan 12 (D-08, D-10, T-170.4-31, T-170.4-37). The scenario commit's
 * server AUM is summed over every live key's rows at the key's own latest day,
 * each exchange account once per day, from SERVICE-WRITTEN evidence only. Since
 * Phase 167.1.1.2 (D-04) that sum is on the EQUITY basis: a spot row counts its
 * value_usd, a derivative row its unrealized P&L, never its notional.
 *
 * The harness serves `api_keys`, `allocator_holdings`, `allocator_equity_derived`
 * and `audit_log` from fixtures that HONOUR `eq`, `order` and `limit`, because the
 * route now goes through the dashboard's three-step reader rather than one
 * unfiltered SELECT. `tablesRead` records every table the route asks for, so the
 * "the audit log is never read" claim is asserted on what was asked, not on what
 * came back.
 *
 * Every dollar figure below is hand-typed, not computed by the code under test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics/onboarding-funnel", () => ({
  stampOutcomeMarker: vi.fn(async () => undefined),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: vi.fn(), updateUserById: vi.fn() } },
    from: () => {
      throw new Error("[test] route should not touch admin.from()");
    },
  }),
}));

const MOCK_USER = { id: "alloc-A" } as unknown as import("@supabase/supabase-js").User;
vi.mock("@/lib/api/withAllocatorAuth", () => ({
  withAllocatorAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => unknown) => (req: NextRequest) =>
      h(req, MOCK_USER),
}));

type Row = Record<string, unknown>;
type KeyFx = {
  id: string;
  exchange: string;
  venue_account_id?: string | null;
  account_share_kind?: string | null;
  account_shared_with_api_key_id?: string | null;
};
type HoldingFx = {
  api_key_id: string;
  venue: string;
  symbol: string;
  holding_type: string;
  value_usd: number;
  unrealized_pnl_usd?: number | null;
  asof: string;
  updated_at: string;
};

let keysFixture: KeyFx[] = [];
let holdingsFixture: HoldingFx[] = [];
let derivedFixture: Row[] = [];
let forgedAuditFixture: Row[] = [];
let holdingsError: { message: string } | null = null;
const tablesRead: string[] = [];
const holdingsSelects: unknown[] = [];

/** A thenable query that honours eq / like / order / limit over `source`. */
function query(
  source: Row[],
  error: { message: string } | null,
  selectLog?: unknown[],
) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  let like: { column: string; prefix: string } | null = null;
  let order: { column: string; ascending: boolean } | null = null;
  let limit: number | null = null;
  const chain = {
    select: (cols?: unknown) => {
      selectLog?.push(cols);
      return chain;
    },
    eq: (c: string, v: unknown) => {
      eqs.push([c, v]);
      return chain;
    },
    in: (c: string, values: unknown[]) => {
      ins.push([c, values]);
      return chain;
    },
    like: (c: string, pattern: string) => {
      like = { column: c, prefix: pattern.replace(/%$/, "") };
      return chain;
    },
    order: (c: string, o: { ascending: boolean }) => {
      order = { column: c, ascending: o.ascending };
      return chain;
    },
    limit: (n: number) => {
      limit = n;
      return chain;
    },
    then: (resolve: (v: unknown) => void) => {
      if (error) return resolve({ data: null, error });
      let rows = source.filter(
        (r) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c])),
      );
      if (like) {
        const { column, prefix } = like;
        rows = rows.filter((r) => String(r[column]).startsWith(prefix));
      }
      if (order) {
        const { column, ascending } = order;
        rows = [...rows].sort(
          (a, b) => (String(a[column]) < String(b[column]) ? -1 : 1) * (ascending ? 1 : -1),
        );
      }
      if (limit !== null) rows = rows.slice(0, limit);
      return resolve({ data: rows, error: null });
    },
  };
  return chain;
}

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: vi.fn((table: string) => {
      tablesRead.push(table);
      if (table === "api_keys") {
        return query(
          keysFixture.map((k) => ({ user_id: "alloc-A", ...k })),
          holdingsError,
        );
      }
      if (table === "allocator_holdings") {
        return query(
          holdingsFixture.map((h) => ({ allocator_id: "alloc-A", ...h })),
          holdingsError,
          holdingsSelects,
        );
      }
      if (table === "allocator_equity_derived") {
        return query(derivedFixture.map((d) => ({ allocator_id: "alloc-A", ...d })), null);
      }
      if (table === "audit_log") return query(forgedAuditFixture, null);
      return query([], null);
    }),
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  checkLimit: vi.fn(async () => ({ success: true })),
  isRateLimitMisconfigured: vi.fn(() => false),
}));
vi.mock("@/lib/audit", () => ({ emit: vi.fn(async () => {}) }));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));

import { POST } from "./route";
import { emit } from "@/lib/audit";

function mkReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/allocator/scenario/commit"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okRpc(kind: "voluntary_add" | "voluntary_remove") {
  mockRpc.mockResolvedValueOnce({
    data: {
      ok: true,
      recorded: [{ index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind }],
    },
    error: null,
  });
}

function auditMeta(call = 0): Record<string, unknown> {
  const calls = (emit as unknown as { mock: { calls: unknown[][] } }).mock.calls as Array<
    [unknown, { metadata: Record<string, unknown> }]
  >;
  return calls[call][1].metadata;
}

const VALID_VA = {
  kind: "voluntary_add" as const,
  strategy_id: "11111111-2222-4333-8444-555555555555",
  percent_allocated: 10,
  size_at_decision_usd: 1,
};
const REMOVE_BTC = {
  kind: "voluntary_remove" as const,
  holding_ref: "holding:binance:BTC:spot",
  size_at_decision_usd: 1,
  rejection_reason: "underperforming_peers" as const,
};

const hold = (
  api_key_id: string,
  venue: string,
  symbol: string,
  value_usd: number,
  updated_at: string,
  over: Partial<HoldingFx> = {},
): HoldingFx => ({
  api_key_id,
  venue,
  symbol,
  holding_type: "spot",
  value_usd,
  asof: "2026-10-11",
  updated_at,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  keysFixture = [];
  holdingsFixture = [];
  derivedFixture = [];
  forgedAuditFixture = [];
  holdingsError = null;
  tablesRead.length = 0;
  holdingsSelects.length = 0;
  mockRpc.mockReset();
});

describe("170.4 D-08: two keys on different accounts are BOTH counted", () => {
  // key-a binance spot BTC 40000, key-b binance spot BTC 25000, key-c okx
  // BTC-USDT-SWAP notional 30000 with unrealized 1200.
  //   notional sum (retired, 167.1.1.2 D-04) = 40000 + 25000 + 30000 = 95000
  //   equity   AUM (sizes the row)            = 40000 + 25000 + 1200  = 66200
  //   voluntary_remove of holding:binance:BTC:spot = 40000 + 25000 = 65000
  const twoAccounts = () => {
    keysFixture = [
      { id: "key-a", exchange: "binance", venue_account_id: "acct-1" },
      { id: "key-b", exchange: "binance", venue_account_id: "acct-2" },
      { id: "key-c", exchange: "okx", venue_account_id: "acct-3" },
    ];
    holdingsFixture = [
      hold("key-a", "binance", "BTC", 40000, "2026-10-11T04:00:00+00:00"),
      hold("key-b", "binance", "BTC", 25000, "2026-10-11T04:01:00+00:00"),
      hold("key-c", "okx", "BTC-USDT-SWAP", 30000, "2026-10-11T04:02:00+00:00", {
        holding_type: "derivative",
        unrealized_pnl_usd: 1200,
      }),
    ];
  };

  it("sizes a 10% add from the 66200 equity AUM of all three keys", async () => {
    twoAccounts();
    okRpc("voluntary_add");
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_aum");
    // 10% x (40000 + 25000 + 1200) = 6620, hand-computed. Never 9500 (10% x the
    // 95000 notional sum).
    expect(auditMeta().size_at_decision_usd).toBe(6620);
  });

  it("a swap notional of 3,000,000 (P&L still 1200) records the same 6620 (notional invariance)", async () => {
    twoAccounts();
    holdingsFixture[2].value_usd = 3_000_000;
    okRpc("voluntary_add");
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_aum");
    // The derivative contributes its P&L, 1200, at any notional:
    // 10% x (40000 + 25000 + 1200) = 6620.
    expect(auditMeta().size_at_decision_usd).toBe(6620);
  });

  it("sizes voluntary_remove of holding:binance:BTC:spot at 65000, both keys' rows", async () => {
    twoAccounts();
    okRpc("voluntary_remove");
    const res = await POST(mkReq({ diffs: [REMOVE_BTC] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_holding");
    expect(auditMeta().size_at_decision_usd).toBe(65000);
  });

  it("selects unrealized_pnl_usd on the allocator_holdings read (it is the only thing that sizes a derivative, D-04)", async () => {
    // The fixtures above carry unrealized_pnl_usd whatever the route selects, so
    // dropping the column from the projection would leave every size assertion
    // green. Pin the column list the route actually asks for.
    twoAccounts();
    okRpc("voluntary_add");
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    // The reader also selects "asof" alone to find the latest day; the row
    // projection is the call that names columns.
    expect(holdingsSelects.some((cols) => String(cols).includes("unrealized_pnl_usd"))).toBe(true);
  });

  it("a client manual AUM of 66200 (the composer's equity total) raises no conflict", async () => {
    twoAccounts();
    okRpc("voluntary_add");
    const res = await POST(mkReq({ diffs: [VALID_VA], manual_aum_usd: 66200 }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_aum");
  });

  it("non-vacuity: a manual AUM far from 66200 DOES raise the conflict", async () => {
    twoAccounts();
    okRpc("voluntary_add");
    const res = await POST(mkReq({ diffs: [VALID_VA], manual_aum_usd: 40000 }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_aum_manual_conflict");
  });

  it("a key's rows before its own latest day no longer count (R-15-1)", async () => {
    twoAccounts();
    holdingsFixture.push(
      hold("key-a", "binance", "BTC", 99999, "2026-10-09T04:00:00+00:00", { asof: "2026-10-09" }),
      hold("key-a", "binance", "ETH", 7777, "2026-10-09T04:00:00+00:00", { asof: "2026-10-09" }),
    );
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA] }));
    // The older-day rows add nothing: 10% x 66200 = 6620.
    expect(auditMeta().size_at_decision_usd).toBe(6620);
  });
});

describe("170.4 D-10: keys that share ONE exchange account count it once", () => {
  // key-b is marked a duplicate of key-a. Same day; key-b polled later but read
  // spot only. The winner is picked per holding type (review WR-01): spot is
  // key-b's (BTC 30000 + ETH 5000 = 35000, key-a's BTC 30000 does not count) and
  // the derivative class stays key-a's (SOL-PERP, notional 12000, unrealized 400).
  // Notional sum (retired, 167.1.1.2 D-04) 35000 + 12000 = 47000; equity AUM,
  // which sizes the row, 35000 + 400 = 35400.
  const oneAccount = () => {
    keysFixture = [
      { id: "key-a", exchange: "binance", venue_account_id: "acct-D" },
      {
        id: "key-b",
        exchange: "binance",
        venue_account_id: null,
        account_share_kind: "duplicate",
        account_shared_with_api_key_id: "key-a",
      },
    ];
    holdingsFixture = [
      hold("key-a", "binance", "BTC", 30000, "2026-10-11T04:00:05.123456+00:00"),
      hold("key-a", "binance", "SOL-PERP", 12000, "2026-10-11T04:00:05.123456+00:00", {
        holding_type: "derivative",
        unrealized_pnl_usd: 400,
      }),
      hold("key-b", "binance", "BTC", 30000, "2026-10-11T04:02:10.5+00:00"),
      hold("key-b", "binance", "ETH", 5000, "2026-10-11T04:02:10.5+00:00"),
    ];
  };

  it("sizes a 10% add from the 35400 equity AUM, not the 77000 of both keys' BTC", async () => {
    oneAccount();
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA] }));
    // 10% x (35000 + 400) = 3540, hand-computed. Never 4700 (10% x 47000
    // notional) and never 10% x 77000 (the shared BTC counted twice).
    expect(auditMeta().size_at_decision_usd).toBe(3540);
  });

  it("voluntary_remove of the shared BTC is 30000, one key's row", async () => {
    oneAccount();
    okRpc("voluntary_remove");
    await POST(mkReq({ diffs: [REMOVE_BTC] }));
    expect(auditMeta().size_at_decision_usd).toBe(30000);
  });

  it("the equity comparison figure also counts the account once: manual 35400 is no conflict", async () => {
    oneAccount();
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA], manual_aum_usd: 35400 }));
    expect(auditMeta()._size_source).toBe("server_aum");
  });
});

describe("170.4 T-170.4-31: the figure rests on service-written evidence only", () => {
  const oneKey = () => {
    keysFixture = [{ id: "key-a", exchange: "binance", venue_account_id: "acct-1" }];
    holdingsFixture = [hold("key-a", "binance", "BTC", 40000, "2026-10-10T04:00:00+00:00", { asof: "2026-10-10" })];
  };

  it("a forged clean-poll audit event dated after the rows cannot move the figure, and audit_log is never read", async () => {
    oneKey();
    forgedAuditFixture = [
      {
        user_id: "alloc-A",
        action: "allocator.holdings.sync_completed",
        entity_type: "api_key",
        entity_id: "key-a",
        created_at: "2026-10-11T04:00:05+00:00",
        metadata: { final_status: "complete", row_count: 0, asof: "2026-10-11" },
        "metadata->>final_status": "complete",
      },
    ];
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [{ ...VALID_VA, percent_allocated: 50 }] }));
    expect(auditMeta().size_at_decision_usd).toBe(20000);
    expect(tablesRead).not.toContain("audit_log");
  });

  it("KNOWN LIMIT: the same event written by the service itself is not honoured either, so the commit can exceed the dashboard total", async () => {
    // The dashboard would drop this key (a clean empty poll newer than its
    // rows). The commit cannot tell that event from a forged one, so it keeps
    // the key's rows until the key's next written rows (T-170.4-37, accepted).
    oneKey();
    forgedAuditFixture = [
      {
        user_id: "alloc-A",
        action: "allocator.holdings.sync_completed",
        entity_type: "api_key",
        entity_id: "key-a",
        created_at: "2026-10-11T04:00:05+00:00",
        metadata: { final_status: "complete", row_count: 0, asof: "2026-10-11" },
        "metadata->>final_status": "complete",
      },
    ];
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [{ ...VALID_VA, percent_allocated: 50 }] }));
    expect(auditMeta()._size_source).toBe("server_aum");
    expect(auditMeta().size_at_decision_usd).toBe(20000);
  });
});

describe("170.4: a failed holdings read keeps today's failure semantics", () => {
  it("a reader error records lookup_failed and the commit still lands (200)", async () => {
    keysFixture = [{ id: "key-a", exchange: "binance" }];
    holdingsFixture = [hold("key-a", "binance", "BTC", 40000, "2026-10-11T04:00:00+00:00")];
    holdingsError = { message: "connection refused (test)" };
    okRpc("voluntary_add");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("lookup_failed");
    expect(auditMeta().size_at_decision_usd).toBeNull();
    warn.mockRestore();
  });

  it("a holdings row without a parseable updated_at is a lookup failure, never a failed commit", async () => {
    keysFixture = [{ id: "key-a", exchange: "binance" }];
    holdingsFixture = [
      hold("key-a", "binance", "BTC", 40000, null as unknown as string),
    ];
    okRpc("voluntary_add");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("lookup_failed");
    warn.mockRestore();
  });
});

// ===========================================================================
// 167.1.1.2 AUMBASIS (D-01, D-02, D-03, D-04). The audit size rests on the
// dashboard's EQUITY definition (spot value_usd, derivative unrealized P&L). A
// derivative whose P&L is not reported is LEFT OUT and named on the row; an AUM
// at or below zero is recorded as null under its own sentinel; a removed
// derivative is sized at its signed P&L. Every figure is typed by hand with its
// arithmetic beside it; none is computed by the code under test.
// ===========================================================================
describe("167.1.1.2 AUMBASIS: equity-basis sizing and the named gaps", () => {
  const T = "2026-10-11T04:00:00+00:00";
  const SPOT_BTC = () => hold("key-a", "binance", "BTC", 40000, T);
  const OKX_SWAP = (pnl: number | null = 1200) =>
    hold("key-c", "okx", "BTC-USDT-SWAP", 30000, T, {
      holding_type: "derivative",
      unrealized_pnl_usd: pnl,
    });
  const BYBIT_ETH = (keyId: string, pnl: number | null) =>
    hold(keyId, "bybit", "ETH-PERP", 50000, T, {
      holding_type: "derivative",
      unrealized_pnl_usd: pnl,
    });
  const ETH_REF = "holding:bybit:ETH-PERP:derivative";
  const OKX_REF = "holding:okx:BTC-USDT-SWAP:derivative";

  // Book M: spot BTC 40000 (key-a), okx swap notional 30000 / P&L 1200 (key-c),
  // bybit ETH-PERP notional 50000 / P&L null (key-d).
  const bookM = () => {
    keysFixture = [
      { id: "key-a", exchange: "binance", venue_account_id: "acct-1" },
      { id: "key-c", exchange: "okx", venue_account_id: "acct-3" },
      { id: "key-d", exchange: "bybit", venue_account_id: "acct-4" },
    ];
    holdingsFixture = [SPOT_BTC(), OKX_SWAP(), BYBIT_ETH("key-d", null)];
  };
  const remove = (ref: string) => ({ ...REMOVE_BTC, holding_ref: ref });

  it("(b) a 10% add on M leaves the null-P&L perp out: 10% x (40000 + 1200) = 4120, one row and its ref named", async () => {
    bookM();
    okRpc("voluntary_add");
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    const m = auditMeta();
    expect(m._size_source).toBe("server_aum");
    expect(m.size_at_decision_usd).toBe(4120);
    expect(m.aum_left_out_count).toBe(1);
    expect(m.aum_left_out_refs).toEqual([ETH_REF]);
  });

  it("(f1) removing the okx swap records its P&L, 1200, never its 30000 notional", async () => {
    bookM();
    okRpc("voluntary_remove");
    await POST(mkReq({ diffs: [remove(OKX_REF)] }));
    expect(auditMeta()._size_source).toBe("server_holding");
    expect(auditMeta().size_at_decision_usd).toBe(1200);
  });

  it("(f2) removing a LOSING derivative records its negative P&L, -800", async () => {
    keysFixture = [
      { id: "key-a", exchange: "binance", venue_account_id: "acct-1" },
      { id: "key-c", exchange: "okx", venue_account_id: "acct-3" },
    ];
    holdingsFixture = [SPOT_BTC(), OKX_SWAP(-800)];
    okRpc("voluntary_remove");
    await POST(mkReq({ diffs: [remove(OKX_REF)] }));
    expect(auditMeta()._size_source).toBe("server_holding");
    expect(auditMeta().size_at_decision_usd).toBe(-800);
  });

  it("(g) removing the perp whose P&L is missing records null by name, never 0 and never its 50000 notional", async () => {
    bookM();
    okRpc("voluntary_remove");
    await POST(mkReq({ diffs: [remove(ETH_REF)] }));
    expect(auditMeta()._size_source).toBe("server_holding_pnl_missing");
    expect(auditMeta().size_at_decision_usd).toBeNull();
  });

  describe("(g2) one ref on two keys, P&L missing on one of them", () => {
    // ETH-PERP held on key-d (P&L null) AND key-e (P&L 300), plus spot 40000.
    const mixed = () => {
      keysFixture = [
        { id: "key-a", exchange: "binance", venue_account_id: "acct-1" },
        { id: "key-d", exchange: "bybit", venue_account_id: "acct-4" },
        { id: "key-e", exchange: "bybit", venue_account_id: "acct-5" },
      ];
      holdingsFixture = [SPOT_BTC(), BYBIT_ETH("key-d", null), BYBIT_ETH("key-e", 300)];
    };

    it("removing the mixed ref is null by name: a partial 300 would state a size the holding never had", async () => {
      mixed();
      okRpc("voluntary_remove");
      await POST(mkReq({ diffs: [remove(ETH_REF)] }));
      expect(auditMeta()._size_source).toBe("server_holding_pnl_missing");
      expect(auditMeta().size_at_decision_usd).toBeNull();
    });

    it("a 10% add on it counts the reported 300: 10% x (40000 + 300) = 4030, one row left out", async () => {
      mixed();
      okRpc("voluntary_add");
      await POST(mkReq({ diffs: [VALID_VA] }));
      expect(auditMeta()._size_source).toBe("server_aum");
      expect(auditMeta().size_at_decision_usd).toBe(4030);
      expect(auditMeta().aum_left_out_count).toBe(1);
      expect(auditMeta().aum_left_out_refs).toEqual([ETH_REF]);
    });
  });

  describe("(c)/(d) a book whose only row is left out has no positive AUM", () => {
    const onlyMissing = () => {
      keysFixture = [{ id: "key-d", exchange: "bybit", venue_account_id: "acct-4" }];
      holdingsFixture = [BYBIT_ETH("key-d", null)];
    };

    it("(c) records null under server_aum_not_positive, not no_holdings_snapshot and not client_unverified", async () => {
      onlyMissing();
      okRpc("voluntary_add");
      await POST(mkReq({ diffs: [VALID_VA] }));
      expect(auditMeta()._size_source).toBe("server_aum_not_positive");
      expect(auditMeta().size_at_decision_usd).toBeNull();
      expect(auditMeta().aum_left_out_count).toBe(1);
    });

    it("(d) a client manual AUM of 50000 does not size it: still null, the claim is only recorded", async () => {
      onlyMissing();
      okRpc("voluntary_add");
      await POST(mkReq({ diffs: [VALID_VA], manual_aum_usd: 50000 }));
      expect(auditMeta()._size_source).toBe("server_aum_not_positive");
      expect(auditMeta().size_at_decision_usd).toBeNull();
      expect(auditMeta().client_manual_aum_usd).toBe(50000);
    });
  });

  it("(e) spot 1000 and a derivative at -4000 make an AUM of -3000: null under server_aum_not_positive, nothing left out", async () => {
    keysFixture = [
      { id: "key-a", exchange: "binance", venue_account_id: "acct-1" },
      { id: "key-c", exchange: "okx", venue_account_id: "acct-3" },
    ];
    holdingsFixture = [hold("key-a", "binance", "BTC", 1000, T), OKX_SWAP(-4000)];
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA] }));
    expect(auditMeta()._size_source).toBe("server_aum_not_positive");
    expect(auditMeta().size_at_decision_usd).toBeNull();
    expect(auditMeta().aum_left_out_count).toBe(0);
    expect(auditMeta().aum_left_out_refs).toEqual([]);
  });

  it("(e2) a single derivative with a REPORTED P&L of 0 is an AUM of 0: null under server_aum_not_positive, count 0", async () => {
    keysFixture = [{ id: "key-c", exchange: "okx", venue_account_id: "acct-3" }];
    holdingsFixture = [OKX_SWAP(0)];
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA] }));
    expect(auditMeta()._size_source).toBe("server_aum_not_positive");
    expect(auditMeta().size_at_decision_usd).toBeNull();
    expect(auditMeta().aum_left_out_count).toBe(0);
  });

  it("(h) a failed holdings read records the left-out count and refs as null, not 0 and not []: the lookup reached no verdict", async () => {
    bookM();
    holdingsError = { message: "connection refused (test)" };
    okRpc("voluntary_add");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await POST(mkReq({ diffs: [VALID_VA] }));
    warn.mockRestore();
    expect(auditMeta()._size_source).toBe("lookup_failed");
    expect(auditMeta().size_at_decision_usd).toBeNull();
    expect(auditMeta().aum_left_out_count).toBeNull();
    expect(auditMeta().aum_left_out_refs).toBeNull();
  });

  it("an empty book with no manual AUM stays no_holdings_snapshot, with 0 / [] (the lookup ran)", async () => {
    keysFixture = [{ id: "key-a", exchange: "binance", venue_account_id: "acct-1" }];
    holdingsFixture = [];
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA] }));
    expect(auditMeta()._size_source).toBe("no_holdings_snapshot");
    expect(auditMeta().size_at_decision_usd).toBeNull();
    expect(auditMeta().aum_left_out_count).toBe(0);
    expect(auditMeta().aum_left_out_refs).toEqual([]);
  });

  it("an empty book with a manual AUM of 100000 still sizes 10% = 10000 under client_manual_aum", async () => {
    keysFixture = [{ id: "key-a", exchange: "binance", venue_account_id: "acct-1" }];
    holdingsFixture = [];
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA], manual_aum_usd: 100000 }));
    expect(auditMeta()._size_source).toBe("client_manual_aum");
    expect(auditMeta().size_at_decision_usd).toBe(10000);
  });

  it("the refs list is capped at 50, sorted ascending, while the count stays 51", async () => {
    keysFixture = [
      { id: "key-a", exchange: "binance", venue_account_id: "acct-1" },
      { id: "key-d", exchange: "bybit", venue_account_id: "acct-4" },
    ];
    // PERP-00 .. PERP-50: 51 distinct derivative refs, all with P&L null, entered
    // in DESCENDING order so a sort that is missing cannot pass by accident.
    const perps = Array.from({ length: 51 }, (_, i) => `PERP-${String(i).padStart(2, "0")}`);
    holdingsFixture = [
      hold("key-a", "binance", "BTC", 1000, T),
      ...[...perps].reverse().map((sym) =>
        hold("key-d", "bybit", sym, 5000, T, {
          holding_type: "derivative",
          unrealized_pnl_usd: null,
        }),
      ),
    ];
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA] }));
    expect(auditMeta().size_at_decision_usd).toBe(100); // 10% x 1000
    expect(auditMeta().aum_left_out_count).toBe(51);
    const refs = auditMeta().aum_left_out_refs as string[];
    expect(refs).toHaveLength(50);
    // Hand-typed ends of the sorted window: PERP-00 first, PERP-49 last (PERP-50 is cut).
    expect(refs[0]).toBe("holding:bybit:PERP-00:derivative");
    expect(refs[49]).toBe("holding:bybit:PERP-49:derivative");
  });

  it("invariant: removing every holding of twoAccounts sums to the AUM a 100% add records (65000 + 1200 = 66200)", async () => {
    keysFixture = [
      { id: "key-a", exchange: "binance", venue_account_id: "acct-1" },
      { id: "key-b", exchange: "binance", venue_account_id: "acct-2" },
      { id: "key-c", exchange: "okx", venue_account_id: "acct-3" },
    ];
    holdingsFixture = [
      hold("key-a", "binance", "BTC", 40000, T),
      hold("key-b", "binance", "BTC", 25000, T),
      OKX_SWAP(1200),
    ];
    okRpc("voluntary_remove");
    await POST(mkReq({ diffs: [REMOVE_BTC] })); // call 0: 40000 + 25000
    okRpc("voluntary_remove");
    await POST(mkReq({ diffs: [remove(OKX_REF)] })); // call 1: 1200
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [{ ...VALID_VA, percent_allocated: 100 }] })); // call 2: 100% x AUM
    const removed = (auditMeta(0).size_at_decision_usd as number) + (auditMeta(1).size_at_decision_usd as number);
    expect(auditMeta(0).size_at_decision_usd).toBe(65000);
    expect(auditMeta(1).size_at_decision_usd).toBe(1200);
    expect(auditMeta(2).size_at_decision_usd).toBe(66200);
    expect(removed).toBe(auditMeta(2).size_at_decision_usd);
  });
});
