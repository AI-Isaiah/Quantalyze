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

type Result = { data: unknown; error: unknown };

const { state, mockIsAdmin, mockCreateAdminClient } = vi.hoisted(() => {
  const state = {
    calls: [] as { method: string; args: unknown[] }[],
    // Default result for a page chain (the paginated compute_jobs_admin read).
    result: { data: [] as unknown, error: null as unknown } as Result,
    // D-07 facet seeds. `registry` answers a `compute_job_kinds` chain. `probes`
    // answers a `compute_jobs_admin` chain that ended in `.eq("kind", name)`,
    // keyed by name; a name not in `probes` falls through to `result`, so the
    // page-filter arms (which also use `.eq("kind", …)`) keep their meaning.
    registry: { data: [] as unknown, error: null as unknown } as Result,
    probes: {} as Record<string, Result>,
  };
  // A chainable, awaitable stand-in for the supabase-js query builder: every
  // method records itself and returns the SAME chain; awaiting it yields the
  // result selected by the chain's own table and kind filter. `from()` returns
  // a FRESH chain per call, so the parallel per-kind probes each resolve their
  // own result instead of sharing one builder's state.
  function makeChain(table: unknown) {
    const chain: Record<string, unknown> = {};
    let eqKind: string | undefined;
    for (const method of ["select", "eq", "order", "range", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        state.calls.push({ method, args });
        if (method === "eq" && args[0] === "kind") eqKind = String(args[1]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      let result = state.result;
      if (table === "compute_job_kinds") result = state.registry;
      else if (eqKind !== undefined && eqKind in state.probes) result = state.probes[eqKind];
      return Promise.resolve(result).then(resolve, reject);
    };
    return chain;
  }
  const from = (...args: unknown[]) => {
    state.calls.push({ method: "from", args });
    return makeChain(args[0]);
  };
  // `rpc` is recorded too, so a regression back to the database function
  // fails on an assertion (the call log) rather than on a missing method.
  const rpc = (...args: unknown[]) => {
    state.calls.push({ method: "rpc", args });
    return Promise.resolve(state.result);
  };
  const mockCreateAdminClient = vi.fn(() => ({ from, rpc }));
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
    state.registry = { data: [], error: null };
    state.probes = {};
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
    // A page request never touches the kind registry: the facet is its own query.
    expect(callsOf("from").map((c) => c.args[0])).not.toContain("compute_job_kinds");
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

  describe("?facets=kinds (D-07)", () => {
    const REGISTRY = ["sync_trades", "derive_allocator_equity", "stitch_composite"];
    const HIT = { data: [{ id: "j" }], error: null };
    const MISS = { data: [], error: null };

    function seedKinds() {
      state.registry = { data: REGISTRY.map((name) => ({ name })), error: null };
      state.probes = {
        sync_trades: HIT,
        derive_allocator_equity: HIT,
        stitch_composite: MISS,
      };
    }

    it("F1: returns, sorted, exactly the registered kinds that have a job", async () => {
      seedKinds();
      const { GET } = await import("./route");
      const res = await GET(makeReq({ facets: "kinds" }));

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toMatch(/no-store/);
      expect(await res.json()).toEqual({ kinds: ["derive_allocator_equity", "sync_trades"] });
    });

    it("F2: is its own query: registry, one limit(1) probe per kind, no page read", async () => {
      seedKinds();
      const { GET } = await import("./route");
      // Page-only params must be ignored on a facets request.
      await GET(makeReq({ facets: "kinds", status: "done", kind: "ignored", exchange: "okx", limit: "5" }));

      expect(callsOf("from").map((c) => c.args[0])).toEqual([
        "compute_job_kinds",
        "compute_jobs_admin",
        "compute_jobs_admin",
        "compute_jobs_admin",
      ]);
      expect(callsOf("eq")).toEqual(
        REGISTRY.map((name) => ({ method: "eq", args: ["kind", name] })),
      );
      expect(callsOf("limit")).toEqual(REGISTRY.map(() => ({ method: "limit", args: [1] })));
      expect(callsOf("range")).toEqual([]);
      expect(callsOf("order")).toEqual([]);
      expect(callsOf("rpc")).toEqual([]);
    });

    it("F3: a non-admin gets 403 and the service-role client is never constructed", async () => {
      mockIsAdmin.mockResolvedValue(false);
      const { GET } = await import("./route");
      const res = await GET(makeReq({ facets: "kinds" }));

      expect(res.status).toBe(403);
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
      expect(state.calls).toEqual([]);
    });

    it("F3b: a cross-origin facets request is refused before any auth or database work", async () => {
      const { GET } = await import("./route");
      const res = await GET(makeReq({ facets: "kinds" }, "https://evil.example"));

      expect(res.status).toBe(403);
      expect(mockIsAdmin).not.toHaveBeenCalled();
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    });

    it("F4: a registry read error is a generic 500 and the raw error is logged", async () => {
      state.registry = { data: null, error: { message: "registry read failed" } };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeReq({ facets: "kinds" }));

      expect(res.status).toBe(500);
      expect(res.headers.get("cache-control")).toMatch(/no-store/);
      const body = await res.json();
      expect(body).toEqual({ error: "Failed to fetch compute job kinds" });
      expect(JSON.stringify(body)).not.toContain("registry read failed");
      expect(spy).toHaveBeenCalledWith(expect.any(String), { message: "registry read failed" });
      spy.mockRestore();
    });

    it("F4b: any probe error is the same generic 500, never a silently shorter list", async () => {
      seedKinds();
      state.probes.stitch_composite = { data: null, error: { message: "probe failed" } };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const { GET } = await import("./route");
      const res = await GET(makeReq({ facets: "kinds" }));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "Failed to fetch compute job kinds" });
      expect(spy).toHaveBeenCalledWith(expect.any(String), { message: "probe failed" });
      spy.mockRestore();
    });
  });
});
