import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/keys/sync — the feature-flagged sync route rewrite
 * (Sprint 3 Commit 4). Exercises both the new compute_jobs queue path
 * (USE_COMPUTE_JOBS_QUEUE=true) and the legacy after() fire-and-forget path.
 *
 * Mocking strategy:
 *   - vi.mock @/lib/supabase/server  → user-scoped client (ownership check)
 *   - vi.mock @/lib/supabase/admin   → service-role client (RPC + upsert)
 *   - vi.mock @/lib/ratelimit        → rate limiter
 *   - vi.mock @/lib/analytics-client → fetchTrades / computeAnalytics
 *   - vi.mock next/server            → after() capture
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };

// vi.hoisted runs before module-level `const`, so all hoisted
// state must be self-contained — no cross-references to top-level consts.
const {
  TEST_USER,
  mockRpc,
  mockUpsert,
  mockAfter,
  mockFetchTrades,
  mockComputeAnalytics,
  mockLogAuditEvent,
  rateLimitResult,
  ownershipResult,
  // H-0275: capture what the user-scoped ownership query actually touched
  // so the mock can FAIL when a regression points it at the wrong table or
  // drops a filter — the "mock so deep it can't fail" trap (Rule 9).
  ownershipQuery,
  // H-0306: the auth boundary. Flipped to null in the unauthed test so the
  // REAL withAuth (this route does NOT mock it) hits its 401 branch.
  authState,
} = vi.hoisted(() => ({
  TEST_USER: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  mockRpc: vi.fn(),
  mockUpsert: vi.fn(),
  mockAfter: vi.fn(),
  mockFetchTrades: vi.fn(),
  mockComputeAnalytics: vi.fn(),
  // C-0101: hoisted spy so we can assert action + metadata.path on each branch.
  mockLogAuditEvent: vi.fn(),
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
  ownershipResult: {
    data: null as Record<string, string> | null,
  },
  ownershipQuery: {
    table: null as string | null,
    selectCols: null as string | null,
    // Filters captured as [column, value] pairs from each .eq() link.
    filters: [] as Array<[string, unknown]>,
  },
  authState: { user: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" } as { id: string } | null },
}));

const TEST_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_JOB_ID = "22222222-2222-2222-2222-222222222222";

// ── Module mocks ────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: authState.user }, error: null }),
    },
    // H-0275: the mock now introspects the table name + select columns +
    // every .eq() filter, recording them on `ownershipQuery`. Tests assert
    // the route hit `from("strategies").select("id, user_id")` filtered by
    // BOTH `id` and `user_id` — so a regression that swaps the table to
    // `api_keys`, drops the `user_id` filter, or selects the wrong columns
    // is observable instead of silently passing.
    from: (table: string) => {
      ownershipQuery.table = table;
      // A chainable builder where each link records its observable side
      // effect and returns `this`. `single()` is the terminal that resolves
      // the configured ownership result.
      const builder = {
        select: (cols: string) => {
          ownershipQuery.selectCols = cols;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          ownershipQuery.filters.push([col, val]);
          return builder;
        },
        single: async () => ownershipResult,
      };
      return builder;
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
    from: () => ({
      upsert: mockUpsert,
    }),
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => rateLimitResult,
}));

vi.mock("@/lib/analytics-client", () => ({
  fetchTrades: mockFetchTrades,
  computeAnalytics: mockComputeAnalytics,
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

// `@/lib/audit` pulls in `server-only` which throws under vitest+jsdom.
// The route emits `sync.start` on both branches (legacy + queue); the
// coverage regression test asserts the imports, but this unit test
// only cares about the compute-path logic — stub the emission out.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

// Stub the correlation-id helper so we can assert it propagates into
// `enqueue_compute_job`'s p_metadata payload. The real helper reads
// next/headers which is awkward to drive from vitest.
const TEST_CORRELATION_ID = "11111111-2222-3333-4444-555555555555";
vi.mock("@/lib/correlation-id", () => ({
  getCorrelationId: vi.fn().mockResolvedValue(TEST_CORRELATION_ID),
  CORRELATION_HEADER: "x-correlation-id",
}));

// Mock next/server — preserve NextRequest/NextResponse, capture after()
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: mockAfter,
  };
});

// ── Helpers ─────────────────────────────────────────────────────────

function makeReq(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost:3000/api/keys/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("POST /api/keys/sync", () => {
  const originalEnv = process.env.USE_COMPUTE_JOBS_QUEUE;

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    ownershipResult.data = { id: TEST_STRATEGY_ID, user_id: TEST_USER.id };
    ownershipQuery.table = null;
    ownershipQuery.selectCols = null;
    ownershipQuery.filters = [];
    authState.user = { id: TEST_USER.id };
    delete process.env.USE_COMPUTE_JOBS_QUEUE;

    // Default mock implementations
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });
    mockUpsert.mockReturnValue({ error: null });
    mockFetchTrades.mockResolvedValue({ trades_fetched: 42 });
    mockComputeAnalytics.mockResolvedValue({ status: "complete" });
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.USE_COMPUTE_JOBS_QUEUE = originalEnv;
    } else {
      delete process.env.USE_COMPUTE_JOBS_QUEUE;
    }
  });

  // ── 1. Queue path happy path ────────────────────────────────────
  it("enqueues via RPC and returns 202 when USE_COMPUTE_JOBS_QUEUE=true", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({
      accepted: true,
      strategy_id: TEST_STRATEGY_ID,
      status: "syncing",
    });

    // RPC was called with correct args, including the correlation_id
    // forensic thread (Phase 18 Day-2 Bug #1 fix).
    expect(mockRpc).toHaveBeenCalledWith("enqueue_compute_job", {
      p_strategy_id: TEST_STRATEGY_ID,
      p_kind: "sync_trades",
      p_metadata: { correlation_id: TEST_CORRELATION_ID },
    });

    // after() should NOT have been called on the queue path
    expect(mockAfter).not.toHaveBeenCalled();

    // No direct computation_status upsert on the queue path
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  // ── 2. Legacy path happy path ───────────────────────────────────
  it("falls through to after() when queue flag is OFF", async () => {
    // Flag not set — default OFF
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({
      accepted: true,
      strategy_id: TEST_STRATEGY_ID,
      status: "syncing",
    });

    // after() was called with a function
    expect(mockAfter).toHaveBeenCalledTimes(1);
    expect(typeof mockAfter.mock.calls[0][0]).toBe("function");

    // The upsert was called to set computation_status='computing'
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    // RPC should NOT have been called
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ── 3. Ownership mismatch / not-found → 404 (P458) ─────────────
  // P458 (audit-2026-05-07): pre-fix this returned 403 for BOTH "no
  // such strategy" AND "exists but unowned" — but with the same
  // message — so an attacker could probe strategy_id existence via the
  // status code's mere presence vs. a `404 Not Found` fall-through from
  // a different route. The hardened contract is a uniform 404 with a
  // non-discriminating message; the response shape must be identical
  // in both branches so an attacker cannot infer existence.
  it("P458 — returns 404 with uniform message when ownership check returns no row", async () => {
    ownershipResult.data = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Strategy not found");
    // The message must NOT leak the unowned-vs-not-found distinction.
    expect(body.error).not.toMatch(/owned/i);

    // Neither path should have been reached.
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  // ── 4. Idempotency: enqueue twice returns 202 both times ───────
  it("returns 202 on repeated calls (idempotent RPC)", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    // Both calls return the same job id (idempotent behavior)
    mockRpc.mockResolvedValue({ data: TEST_JOB_ID, error: null });

    const { POST } = await import("./route");

    const res1 = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res1.status).toBe(202);

    const res2 = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res2.status).toBe(202);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    // Both return the same response shape
    const body1 = await res1.json();
    const body2 = await res2.json();
    expect(body1).toEqual(body2);
  });

  // ── 5. Rate limit exceeded → 429 ───────────────────────────────
  it("returns 429 with Retry-After when rate-limited", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 42;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = await res.json();
    expect(body.error).toContain("Too many requests");

    // Nothing else should run
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
  });

  // ── 6. RPC error → 503 ─────────────────────────────────────────
  it("returns 503 when enqueue_compute_job RPC fails", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "connection refused", code: "PGRST301" },
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("Could not start sync");

    // Error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("enqueue_compute_job RPC failed"),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  // ── 7. Missing strategy_id → 400 ───────────────────────────────
  it("returns 400 when strategy_id is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing strategy_id");
  });

  // ── 8. Phase 18 Day-2 Bug #1 — correlation_id propagation ───────
  // SC-1 fifth layer: compute_jobs.metadata->>'correlation_id' must be
  // queryable end-to-end. The 062 + 032 RPC signature accepts
  // p_metadata JSONB; this route was passing only {p_strategy_id, p_kind}
  // before the fix, leaving the forensic chain incomplete. Without the
  // import + getCorrelationId() call + p_metadata key in the rpc args,
  // this test fails because mockRpc receives no `p_metadata` field.
  it("threads getCorrelationId() into enqueue_compute_job p_metadata.correlation_id (Phase 18 Bug #1)", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(202);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    const [rpcName, rpcArgs] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(rpcName).toBe("enqueue_compute_job");
    expect(rpcArgs.p_metadata).toEqual({ correlation_id: TEST_CORRELATION_ID });
  });

  // ── C-0101: sync.start audit emission shape ────────────────────────
  // The route emits `sync.start` on BOTH branches (queue + legacy) with
  // a metadata.path discriminator. A regression that hits the wrong
  // branch silently corrupts the forensic signal — operators querying
  // audit_log for "queue stalls vs legacy after() failures" would see
  // the wrong attribution. These two tests pin the exact emission shape
  // per branch (action, entity_type, entity_id, metadata.path).
  it("[C-0101 queue branch] emits sync.start with metadata.path='queue' when USE_COMPUTE_JOBS_QUEUE=true", async () => {
    process.env.USE_COMPUTE_JOBS_QUEUE = "true";

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = mockLogAuditEvent.mock.calls[0] as [
      unknown,
      {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata: Record<string, unknown>;
      },
    ];
    expect(event.action).toBe("sync.start");
    expect(event.entity_type).toBe("sync");
    expect(event.entity_id).toBe(TEST_STRATEGY_ID);
    expect(event.metadata).toEqual({ path: "queue" });
  });

  it("[C-0101 legacy branch] emits sync.start with metadata.path='legacy' when queue flag is OFF", async () => {
    // Flag not set — default OFF.
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);
    const [, event] = mockLogAuditEvent.mock.calls[0] as [
      unknown,
      {
        action: string;
        entity_type: string;
        entity_id: string;
        metadata: Record<string, unknown>;
      },
    ];
    expect(event.action).toBe("sync.start");
    expect(event.entity_type).toBe("sync");
    expect(event.entity_id).toBe(TEST_STRATEGY_ID);
    expect(event.metadata).toEqual({ path: "legacy" });
  });

  it("[C-0101] does NOT emit sync.start on the 429 rate-limit branch", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 7;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(429);

    // Nothing audit-worthy happened — the request never reached either
    // sync branch.
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  // ── H-0306: unmocked withAuth auth boundary → 401 ──────────────────
  // This route wraps the handler in the REAL withAuth (it does NOT mock
  // it), so a missing session must short-circuit at 401 BEFORE any
  // rate-limit, ownership, RPC, or after() work runs. Rule 9: the auth
  // boundary is the single most important invariant on a mutation route;
  // pin that the unauthed branch actually executes.
  it("H-0306 — returns 401 when the session is missing (real withAuth boundary)", async () => {
    authState.user = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");

    // Nothing past the auth gate should have run.
    expect(ownershipQuery.table).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockAfter).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockLogAuditEvent).not.toHaveBeenCalled();
  });

  // ── H-0275: ownership query targets the right table + filters ──────
  // The mock used to return the same select.eq.eq.single chain for ANY
  // table/filter combination, so a regression that pointed the ownership
  // check at `api_keys`, dropped the `user_id` filter, or selected the
  // wrong columns would still pass (Rule 9 — "mock so deep it can't
  // fail"). The mock now records the table/cols/filters; this test pins
  // the contract: from("strategies").select("id, user_id") filtered by
  // BOTH `id`=strategy_id AND `user_id`=user.id.
  it("H-0275 — ownership check queries strategies by id AND user_id", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    // The check must hit the strategies table — NOT api_keys or any other.
    expect(ownershipQuery.table).toBe("strategies");
    // It must select the ownership columns the route relies on.
    expect(ownershipQuery.selectCols).toBe("id, user_id");
    // Both filters must be present: id scopes the row, user_id is the
    // ownership fence. Dropping user_id would let any authenticated user
    // sync any strategy.
    expect(ownershipQuery.filters).toContainEqual(["id", TEST_STRATEGY_ID]);
    expect(ownershipQuery.filters).toContainEqual(["user_id", TEST_USER.id]);
  });

  // ── H-0277: legacy after() failure → compensating 'failed' upsert ──
  // The after() background block has the critical compensating-write path:
  // if fetchTrades / computeAnalytics throws, it MUST upsert
  // {computation_status:'failed', computation_error:<msg>} so SyncPreviewStep
  // stops polling and renders GATE_ANALYTICS_FAILED. A regression that
  // dropped this upsert (or wrote the wrong status) would leave the client
  // polling forever on "still computing". This test drives the catch branch
  // by rejecting computeAnalytics, invokes the captured after() callback,
  // and asserts the failure upsert payload.
  it("H-0277 — after() catch-branch upserts computation_status='failed' with the error message", async () => {
    // Flag OFF — exercise the legacy after() path.
    const FAILURE_MESSAGE = "Railway compute timed out after 300s";
    mockComputeAnalytics.mockRejectedValueOnce(new Error(FAILURE_MESSAGE));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    // The route registered exactly one after() callback (the bg sync).
    expect(mockAfter).toHaveBeenCalledTimes(1);
    const afterCb = mockAfter.mock.calls[0][0] as () => Promise<void>;

    // First upsert was the entry 'computing' status (legacy path).
    expect(mockUpsert).toHaveBeenCalledTimes(1);

    // Drive the background block. computeAnalytics rejects → catch branch
    // fires the compensating failure upsert.
    await afterCb();

    // The catch branch must have issued a SECOND upsert with the failed
    // status + the propagated error message.
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    const failurePayload = mockUpsert.mock.calls[1][0] as Record<string, unknown>;
    expect(failurePayload).toMatchObject({
      strategy_id: TEST_STRATEGY_ID,
      computation_status: "failed",
      computation_error: FAILURE_MESSAGE,
    });

    consoleSpy.mockRestore();
  });

  // ── H-0277 (sibling): a successful after() run does NOT write 'failed' ──
  // Belt-and-braces so the failure assertion above can't pass vacuously:
  // when computeAnalytics resolves, the catch branch must NOT run, so the
  // only upsert is the entry 'computing' write.
  it("H-0277 — after() success path issues no compensating 'failed' upsert", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockFetchTrades.mockResolvedValueOnce({ trades_fetched: 7 });
    mockComputeAnalytics.mockResolvedValueOnce({ status: "complete" });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));
    expect(res.status).toBe(202);

    const afterCb = mockAfter.mock.calls[0][0] as () => Promise<void>;
    await afterCb();

    // Only the entry 'computing' upsert — no 'failed' write.
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    const onlyPayload = mockUpsert.mock.calls[0][0] as Record<string, unknown>;
    expect(onlyPayload.computation_status).toBe("computing");
    consoleSpy.mockRestore();
  });
});
