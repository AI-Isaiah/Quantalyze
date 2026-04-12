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
  rateLimitResult,
  ownershipResult,
} = vi.hoisted(() => ({
  TEST_USER: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  mockRpc: vi.fn(),
  mockUpsert: vi.fn(),
  mockAfter: vi.fn(),
  mockFetchTrades: vi.fn(),
  mockComputeAnalytics: vi.fn(),
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
  ownershipResult: {
    data: null as Record<string, string> | null,
  },
}));

const TEST_STRATEGY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_JOB_ID = "22222222-2222-2222-2222-222222222222";

// ── Module mocks ────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ownershipResult,
          }),
        }),
      }),
    }),
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

    // RPC was called with correct args
    expect(mockRpc).toHaveBeenCalledWith("enqueue_compute_job", {
      p_strategy_id: TEST_STRATEGY_ID,
      p_kind: "sync_trades",
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

  // ── 3. Ownership mismatch → 403 ────────────────────────────────
  it("returns 403 when strategy is not owned by user", async () => {
    ownershipResult.data = null;

    const { POST } = await import("./route");
    const res = await POST(makeReq({ strategy_id: TEST_STRATEGY_ID }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("not owned");

    // Neither path should have been reached
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
});
