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
 *   - On SQLSTATE '40001' (lost enqueue race, Phase 164.6 OPS-08-TS): the RPC
 *     is re-issued exactly once; a success answers 200, a second 40001 the
 *     existing 500. No other code is ever retried.
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
// Real v4 UUIDs (variant bit 10xx → hex starts 8/9/a/b at position 15).
// Zod v4's `.uuid()` enforces the variant byte, so sequential fillers like
// "11111111-...-1111" fail validation.
const TEST_USER_ID = "d4e5f6a7-b8c9-4a1b-8c2d-3e4f5a6b7c8d";
const TEST_API_KEY_ID = "a1b2c3d4-e5f6-4789-89ab-cdef01234567";
const TEST_JOB_ID = "f0e1d2c3-b4a5-4697-8877-aabbccddeeff";

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

// Endpoint under test (single-quoted so the coverage grep for
// '/api/allocator/holdings/sync' catches it — routing plumbing smoke).
const ROUTE_PATH = '/api/allocator/holdings/sync';

function makeReq(body: unknown) {
  return new NextRequest(
    `http://localhost:3000${ROUTE_PATH}`,
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
    // OPS-08-TS: only a 40001 is retried. A permission denial asked twice is
    // still a permission denial, and a second call is wasted load.
    expect(mockRpc, "a 42501 was retried — only a 40001 may be").toHaveBeenCalledTimes(1);

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
    // OPS-08-TS control: a non-40001 error is never retried.
    expect(mockRpc, "a PGRST301 was retried — only a 40001 may be").toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  // ── 6b. OPS-08-TS (Phase 164.6) — a lost enqueue race self-heals ─
  // `_enqueue_compute_job_internal` raises 40001 when this enqueue loses the
  // in-flight race and the winner has already advanced. The route re-issues
  // the whole RPC once (retry-safe: the RPC catches unique_violation only, so
  // a 40001 aborted its whole transaction), and the allocator sees a success
  // instead of "Could not start sync".
  it("retries a 40001 once and answers 200, auditing the sync exactly once", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { code: "40001", message: "enqueue race lost" },
      })
      .mockResolvedValueOnce({
        data: { ok: true, job_id: TEST_JOB_ID },
        error: null,
      });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: TEST_API_KEY_ID }));

    expect(res.status, "a lost enqueue race reached the allocator as an error").toBe(200);
    expect(await res.json()).toEqual({ ok: true, job_id: TEST_JOB_ID });
    expect(mockRpc, "the lost race must be re-issued exactly once").toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(2, "request_allocator_holdings_sync", {
      p_api_key_id: TEST_API_KEY_ID,
    });
    expect(
      mockLogAuditEvent,
      "the eventual success must be audited once — not per attempt",
    ).toHaveBeenCalledTimes(1);
    expect(
      warnSpy.mock.calls.some((c) => /retrying once/.test(String(c[0]))),
      "the retried attempt must leave a console.warn trail",
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it("a 40001 that survives the single retry answers the existing 500, with no audit and no third call", async () => {
    const lostRace = {
      data: null,
      error: { code: "40001", message: "enqueue race lost" },
    };
    mockRpc.mockResolvedValueOnce(lostRace).mockResolvedValueOnce(lostRace);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key_id: TEST_API_KEY_ID }));

    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("Could not start sync");
    expect(
      mockRpc,
      "the retry budget is ONE — one request must never execute the RPC more than twice",
    ).toHaveBeenCalledTimes(2);
    expect(mockLogAuditEvent, "a failed sync was audited as requested").not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
    errorSpy.mockRestore();
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
