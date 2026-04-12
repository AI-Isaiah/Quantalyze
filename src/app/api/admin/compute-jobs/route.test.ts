import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const TEST_USER = { id: "00000000-0000-0000-0000-aaaaaaaaaaaa", email: "admin@test.com" };

const { mockRpc, mockIsAdmin } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockIsAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { is_admin: true }, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mockRpc,
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: mockIsAdmin,
}));

function makeReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/admin/compute-jobs");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: "GET" });
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
    mockIsAdmin.mockResolvedValue(true);
    mockRpc.mockResolvedValue({ data: SAMPLE_JOBS, error: null });
  });

  it("returns data for admin user", async () => {
    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe("sync_trades");
  });

  it("returns 403 for non-admin user", async () => {
    mockIsAdmin.mockResolvedValue(false);

    const { GET } = await import("./route");
    const res = await GET(makeReq());

    expect(res.status).toBe(403);
  });

  it("passes status filter to RPC", async () => {
    const { GET } = await import("./route");
    await GET(makeReq({ status: "failed_retry" }));

    expect(mockRpc).toHaveBeenCalledWith("get_admin_compute_jobs", expect.objectContaining({
      p_status: "failed_retry",
    }));
  });

  it("passes kind filter to RPC", async () => {
    const { GET } = await import("./route");
    await GET(makeReq({ kind: "compute_analytics" }));

    expect(mockRpc).toHaveBeenCalledWith("get_admin_compute_jobs", expect.objectContaining({
      p_kind: "compute_analytics",
    }));
  });

  it("pagination defaults to limit=50 offset=0", async () => {
    const { GET } = await import("./route");
    await GET(makeReq());

    expect(mockRpc).toHaveBeenCalledWith("get_admin_compute_jobs", expect.objectContaining({
      p_limit: 50,
      p_offset: 0,
    }));
  });
});
