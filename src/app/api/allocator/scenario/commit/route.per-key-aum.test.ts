/**
 * Phase 170.4 plan 12 (D-08, D-10, T-170.4-31, T-170.4-37). The scenario commit's
 * server AUM is summed over every live key's rows at the key's own latest day,
 * each exchange account once per day, from SERVICE-WRITTEN evidence only.
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

/** A thenable query that honours eq / like / order / limit over `source`. */
function query(source: Row[], error: { message: string } | null) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  let like: { column: string; prefix: string } | null = null;
  let order: { column: string; ascending: boolean } | null = null;
  let limit: number | null = null;
  const chain = {
    select: () => chain,
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
  mockRpc.mockReset();
});

describe("170.4 D-08: two keys on different accounts are BOTH counted", () => {
  // key-a binance spot BTC 40000, key-b binance spot BTC 25000, key-c okx
  // BTC-USDT-SWAP notional 30000 with unrealized 1200.
  //   notional AUM = 40000 + 25000 + 30000 = 95000
  //   equity   AUM = 40000 + 25000 + 1200  = 66200
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

  it("sizes a 10% add from the 95000 notional AUM of all three keys", async () => {
    twoAccounts();
    okRpc("voluntary_add");
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_aum");
    expect(auditMeta().size_at_decision_usd).toBe(9500);
  });

  it("sizes voluntary_remove of holding:binance:BTC:spot at 65000, both keys' rows", async () => {
    twoAccounts();
    okRpc("voluntary_remove");
    const res = await POST(mkReq({ diffs: [REMOVE_BTC] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_holding");
    expect(auditMeta().size_at_decision_usd).toBe(65000);
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
    expect(auditMeta().size_at_decision_usd).toBe(9500);
  });
});

describe("170.4 D-10: keys that share ONE exchange account count it once", () => {
  // key-b is marked a duplicate of key-a. Same day; key-b polled later but read
  // spot only. The winner is picked per holding type (review WR-01): spot is
  // key-b's (BTC 30000 + ETH 5000 = 35000, key-a's BTC 30000 does not count) and
  // the derivative class stays key-a's (SOL-PERP, notional 12000, unrealized 400).
  // Notional AUM 35000 + 12000 = 47000; equity AUM 35000 + 400 = 35400.
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

  it("sizes a 10% add from 47000, not 77000", async () => {
    oneAccount();
    okRpc("voluntary_add");
    await POST(mkReq({ diffs: [VALID_VA] }));
    expect(auditMeta().size_at_decision_usd).toBe(4700);
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
