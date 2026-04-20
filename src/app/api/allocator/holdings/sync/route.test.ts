import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Unit tests for POST /api/allocator/holdings/sync — Phase 06 Plan 03.
 *
 * Route contract (per 06-03-PLAN.md):
 *   - Wrapped in `withAuth`; body validated via zod (`api_key_id: uuid`).
 *   - Calls `request_allocator_holdings_sync(p_api_key_id)` via the
 *     user-scoped supabase client (NOT admin — RPC is GRANTed to authenticated
 *     and runs its own auth.uid() ownership check).
 *   - On fresh enqueue: RPC returns `{ ok: true, job_id }` → 200 passthrough.
 *   - On dup (in-flight): RPC returns `{ already_inflight: true, next_attempt_at }`
 *     → 200 with both keys preserved VERBATIM (f8).
 *   - On RPC SQLSTATE '42501' (auth / ownership): 403.
 *   - On unexpected RPC error: 500 with generic copy.
 *   - On invalid body (missing / non-uuid api_key_id): 400.
 *   - Emits `allocator.holdings.sync_requested` audit event on success.
 *
 * Mocking strategy mirrors src/app/api/keys/sync/route.test.ts:
 *   - `vi.hoisted` state so mocks can reference state initialized before
 *     module-level consts.
 *   - `@/lib/supabase/server` → fake user-scoped client with `.rpc` spy.
 *   - `@/lib/audit` → spy on `logAuditEvent`.
 *   - `@/lib/csrf` → bypass (same-origin assumed here; CSRF has its own tests).
 *   - `server-only` → stubbed so `@/lib/audit` imports don't blow up.
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };
const TEST_USER_ID = "00000000-0000-0000-0000-aaaaaaaaaaaa";
const TEST_API_KEY_ID = "11111111-1111-1111-1111-111111111111";
const TEST_JOB_ID = "22222222-2222-2222-2222-222222222222";

const { mockRpc, mockLogAuditEvent } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

// ── Module mocks ────────────────────────────────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: TEST_USER_ID } },
        error: null,
      }),
    },
    rpc: mockRpc,
  }),
}));

// `@/lib/audit` pulls in `server-only` which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

// ── Helpers ─────────────────────────────────────────────────────────

function makeReq(body: unknown) {
  return new NextRequest(
    "http://localhost:3000/api/allocator/holdings/sync",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...VALID_ORIGIN },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe("POST /api/allocator/holdings/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({
      data: { ok: true, job_id: TEST_JOB_ID },
      error: null,
    });
  });

  // ── 1. Valid body, fresh enqueue → 200 ──────────────────────────
  it("returns 200 with { ok, job_id } when RPC succeeds with fresh enqueue", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: TEST_API_KEY_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, job_id: TEST_JOB_ID });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("request_allocator_holdings_sync", {
      p_api_key_id: TEST_API_KEY_ID,
    });
  });

  // ── 2. Missing body → 400 ────────────────────────────────────────
  it("returns 400 when body is missing api_key_id", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ── 3. Non-UUID api_key_id → 400 ─────────────────────────────────
  it("returns 400 when api_key_id is not a UUID", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: "not-a-uuid" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // ── 4. RPC returns already_inflight with next_attempt_at → 200 (f8)
  it("returns 200 with already_inflight AND next_attempt_at when RPC signals dup", async () => {
    const nextAt = "2026-04-19T04:02:13.000Z";
    mockRpc.mockResolvedValueOnce({
      data: { already_inflight: true, next_attempt_at: nextAt },
      error: null,
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: TEST_API_KEY_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    // f8: next_attempt_at MUST survive the route transform so the client
    // can render "Queued — retry in {N}s" during rate-limit contagion.
    expect(body).toEqual({ already_inflight: true, next_attempt_at: nextAt });
  });

  // ── 5. RPC raises SQLSTATE 42501 → 403 ──────────────────────────
  it("returns 403 when RPC raises SQLSTATE 42501 (ownership failure)", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "42501",
        message: "api_key_not_found_or_not_owned",
      },
    });

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: TEST_API_KEY_ID }));

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("not found or not owned");

    consoleSpy.mockRestore();
  });

  // ── 6. RPC raises unexpected error → 500 ────────────────────────
  it("returns 500 when RPC raises an unexpected error", async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "PGRST301",
        message: "connection refused",
      },
    });

    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: TEST_API_KEY_ID }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Could not start sync");

    // Internals logged, not surfaced in body.
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // ── 7. Audit event emitted on success path ──────────────────────
  it("emits allocator.holdings.sync_requested audit event on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: TEST_API_KEY_ID }));

    expect(res.status).toBe(200);
    expect(mockLogAuditEvent).toHaveBeenCalledTimes(1);

    const [, event] = mockLogAuditEvent.mock.calls[0] as [
      unknown,
      {
        action: string;
        entity_type: string;
        entity_id: string;
      },
    ];
    expect(event.action).toBe("allocator.holdings.sync_requested");
    expect(event.entity_type).toBe("api_key");
    expect(event.entity_id).toBe(TEST_API_KEY_ID);
  });
});
