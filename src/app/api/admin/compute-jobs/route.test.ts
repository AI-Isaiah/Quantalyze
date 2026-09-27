import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Phase 169.3 plan 01 (SC1, D-15). The route reads the `compute_jobs_admin`
 * VIEW with the service-role client, after the `isAdminUser` gate. It used to
 * call the `get_admin_compute_jobs` database function, which failed on every
 * call (ambiguous `id` OUT column) and, behind that, would have returned
 * nothing because the service role has no `auth.uid()` for the function's own
 * admin check. These tests pin the view read, its projection and filters, the
 * error arm, and that a non-admin never reaches the service-role client.
 */

const TEST_USER = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa", email: "admin@test.com" };

// The exact 21 columns the old function returned; the client row type
// (`ComputeJobAdminRow`) consumes exactly these. The view also carries
// `strategy_user_id` and `portfolio_user_id`, which must NOT be projected.
const EXPECTED_COLUMNS = [
  "id",
  "strategy_id",
  "portfolio_id",
  "kind",
  "status",
  "attempts",
  "max_attempts",
  "next_attempt_at",
  "claimed_at",
  "claimed_by",
  "last_error",
  "error_kind",
  "idempotency_key",
  "exchange",
  "trade_count",
  "created_at",
  "updated_at",
  "metadata",
  "strategy_name",
  "portfolio_name",
  "user_email",
];

type Call = { method: string; args: unknown[] };

const { state, mockIsAdmin, mockCreateAdminClient } = vi.hoisted(() => {
  const state = {
    calls: [] as { method: string; args: unknown[] }[],
    result: { data: [] as unknown, error: null as unknown },
  };
  // A chainable, awaitable stand-in for the supabase-js query builder: every
  // method records itself and returns the builder; awaiting it yields `result`.
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "select", "eq", "order", "range"]) {
    builder[method] = (...args: unknown[]) => {
      state.calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve, reject);
  // `rpc` is recorded too, so a regression back to the database function
  // fails on an assertion (the call log) rather than on a missing method.
  const rpc = (...args: unknown[]) => {
    state.calls.push({ method: "rpc", args });
    return Promise.resolve(state.result);
  };
  const mockCreateAdminClient = vi.fn(() => ({ from: builder.from, rpc }));
  return { state, mockIsAdmin: vi.fn(), mockCreateAdminClient };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: mockIsAdmin,
}));

function makeReq(params: Record<string, string> = {}, origin = "http://localhost:3000") {
  const url = new URL("http://localhost:3000/api/admin/compute-jobs");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // audit-2026-05-07 C-0041 follow-up: route runs assertSameOrigin before auth.
  return new NextRequest(url.toString(), {
    method: "GET",
    headers: { origin },
  });
}

function callsOf(method: string): Call[] {
  return state.calls.filter((c) => c.method === method);
}

const SAMPLE_JOBS = [
  {
    id: "j1",
    strategy_id: "s1",
    portfolio_id: null,
    kind: "sync_trades",
    status: "done",
    attempts: 1,
    max_attempts: 3,
    next_attempt_at: "2026-04-11T00:00:00Z",
    claimed_at: null,
    claimed_by: null,
    last_error: null,
    error_kind: null,
    idempotency_key: null,
    exchange: "binance",
    trade_count: 42,
    created_at: "2026-04-11T00:00:00Z",
    updated_at: "2026-04-11T00:01:00Z",
    metadata: null,
    strategy_name: "Alpha",
    portfolio_name: null,
    user_email: "test@test.com",
  },
];

describe("GET /api/admin/compute-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls.length = 0;
    state.result = { data: SAMPLE_JOBS, error: null };
    mockIsAdmin.mockResolvedValue(true);
  });

  it("returns 200 with the view rows for an admin, uncached", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const body = await res.json();
    expect(body).toEqual(SAMPLE_JOBS);
  });

  it("reads the compute_jobs_admin view, not the broken database function", async () => {
    const { GET } = await import("./route");
    await GET(makeReq());

    expect(callsOf("rpc")).toEqual([]);
    expect(callsOf("from")).toEqual([{ method: "from", args: ["compute_jobs_admin"] }]);
  });

  it("projects exactly the 21 client columns: no star, no *_user_id, no claim_token", async () => {
    const { GET } = await import("./route");
    await GET(makeReq());

    const selects = callsOf("select");
    expect(selects).toHaveLength(1);
    const projection = String(selects[0].args[0])
      .split(",")
      .map((c) => c.trim());
    expect(projection).toEqual(EXPECTED_COLUMNS);
    expect(projection).not.toContain("*");
    expect(projection).not.toContain("claim_token");
    expect(projection).not.toContain("strategy_user_id");
    expect(projection).not.toContain("portfolio_user_id");
  });

  it("orders newest first and ranges the default page [0, 49]", async () => {
    const { GET } = await import("./route");
    await GET(makeReq());

    expect(callsOf("order")).toEqual([
      { method: "order", args: ["created_at", { ascending: false }] },
    ]);
    expect(callsOf("range")).toEqual([{ method: "range", args: [0, 49] }]);
  });

  it("adds no filter when no filter param is present", async () => {
    const { GET } = await import("./route");
    await GET(makeReq());

    expect(callsOf("eq")).toEqual([]);
  });

  it("adds exactly one .eq per present filter param", async () => {
    const { GET } = await import("./route");
    await GET(makeReq({ status: "failed_retry" }));
    expect(callsOf("eq")).toEqual([{ method: "eq", args: ["status", "failed_retry"] }]);

    state.calls.length = 0;
    await GET(makeReq({ kind: "compute_analytics", exchange: "okx" }));
    expect(callsOf("eq")).toEqual([
      { method: "eq", args: ["kind", "compute_analytics"] },
      { method: "eq", args: ["exchange", "okx"] },
    ]);
  });

  it("clamps negative/NaN limit and offset", async () => {
    const { GET } = await import("./route");
    await GET(makeReq({ limit: "-5", offset: "abc" }));

    // limit: Number("-5") = -5 → Math.max(1, ...) = 1 → range [0, 0]
    // offset: Number("abc") = NaN → || 0 → 0
    expect(callsOf("range")).toEqual([{ method: "range", args: [0, 0] }]);
  });

  it("clamps limit to 200 and honours a positive offset", async () => {
    const { GET } = await import("./route");
    await GET(makeReq({ limit: "999", offset: "100" }));

    expect(callsOf("range")).toEqual([{ method: "range", args: [100, 299] }]);
  });

  it("returns the generic 500 when the view read errors, and logs the raw error server-side", async () => {
    state.result = { data: null, error: { message: "relation read failed" } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const body = await res.json();
    expect(body).toEqual({ error: "Failed to fetch compute jobs" });
    expect(JSON.stringify(body)).not.toContain("relation read failed");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("returns 403 for a non-admin and never constructs or queries the service-role client", async () => {
    mockIsAdmin.mockResolvedValue(false);

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(403);
    // T-169-01: the service role bypasses RLS, so a non-admin must cause ZERO
    // database reads through it, not "a read whose rows are thrown away".
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
  });

  it("refuses a cross-origin request before any auth or database work", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq({}, "https://evil.example"));

    expect(res.status).toBe(403);
    expect(mockIsAdmin).not.toHaveBeenCalled();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
