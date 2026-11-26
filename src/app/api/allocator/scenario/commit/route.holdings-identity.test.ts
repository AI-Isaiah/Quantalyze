/**
 * Phase 235 HOLD-01. The scenario commit's audit recompute sizes a persisted
 * figure (`size_at_decision_usd`) from the holdings the dashboard reader
 * returns. An incomplete identity read must never size that figure: a counted
 * row whose key `read.accountByKey` lacks would, under the retired `?? keyId`
 * fallback, count as an account of its own and double-count the account the
 * read left out. The route now counts through `strictAccountOf`, which throws
 * `HoldingsIdentityError`; the route's existing catch turns that into
 * `holdingsLookupErr`, so the audit row says `_size_source: "lookup_failed"`
 * and the commit still lands (200). A failed lookup, never a failed commit.
 *
 * The reader module is partially mocked in THIS file only (a `vi.mock` is
 * file-wide, and route.per-key-aum.test.ts's arms rely on the real reader
 * through its fixture harness). Every dollar figure is hand-typed.
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

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: vi.fn(() => {
      throw new Error("[test] the reader is mocked; the route should not call from()");
    }),
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/latest-holdings-per-key", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/latest-holdings-per-key")>()),
  fetchLatestHoldingsPerKey: vi.fn(),
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
import { fetchLatestHoldingsPerKey } from "@/lib/latest-holdings-per-key";

function mkReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/allocator/scenario/commit"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okRpc() {
  mockRpc.mockResolvedValueOnce({
    data: {
      ok: true,
      recorded: [
        { index: 0, match_decision_id: "md-1", bridge_outcome_id: "bo-1", kind: "voluntary_add" },
      ],
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

// One spot BTC row of key-x worth 40000.
const SPOT_ROW = {
  api_key_id: "key-x",
  venue: "binance",
  symbol: "BTC",
  holding_type: "spot",
  value_usd: 40000,
  unrealized_pnl_usd: null,
  asof: "2026-10-11",
  updated_at: "2026-10-11T04:00:00+00:00",
};

const readWith = (accountByKey: Record<string, string>) => ({
  data: [SPOT_ROW],
  error: null,
  partialReads: [],
  accountByKey,
  markerReadError: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockReset();
});

describe("235 HOLD-01: the commit's audit recompute counts a row only through a complete identity", () => {
  it("a counted row whose key accountByKey lacks is lookup_failed, sizes nothing, and the commit still lands (200)", async () => {
    vi.mocked(fetchLatestHoldingsPerKey).mockResolvedValueOnce(readWith({}) as never);
    okRpc();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("lookup_failed");
    // No server size is computed from the 40000 row (10% of it would be 4000).
    expect(auditMeta().size_at_decision_usd).toBeNull();
    warn.mockRestore();
  });

  it("guard: the same row with its key in accountByKey is server_aum, 10% of 40000 = 4000", async () => {
    vi.mocked(fetchLatestHoldingsPerKey).mockResolvedValueOnce(
      readWith({ "key-x": "account:key-x" }) as never,
    );
    okRpc();
    const res = await POST(mkReq({ diffs: [VALID_VA] }));
    expect(res.status).toBe(200);
    expect(auditMeta()._size_source).toBe("server_aum");
    expect(auditMeta().size_at_decision_usd).toBe(4000);
  });
});
