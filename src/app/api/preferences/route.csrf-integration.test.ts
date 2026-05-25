import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * CSRF INTEGRATION test for PUT /api/preferences — closes audit finding
 * H-0293.
 *
 * The companion `route.test.ts` mocks `@/lib/csrf` to literally return a
 * pre-built 403 (`assertSameOrigin: () => STATE.csrfResponse`). That is
 * the SPECIALIST-LOG C3 antipattern: a bug where the real
 * `assertSameOrigin` stopped checking Origin/Referer would still pass
 * the mocked test. This file deliberately does NOT mock `@/lib/csrf`, so
 * the REAL `assertSameOrigin` runs against forged requests.
 *
 * The downstream collaborators (supabase, ratelimit, audit, approval
 * gate) are still stubbed — but the CSRF gate is the FIRST check in the
 * PUT handler and short-circuits before any of them, so these stubs are
 * never reached on the deny paths. The "allowed origin" case is included
 * to prove the gate does not over-block a legitimate same-origin
 * request (otherwise an always-403 stub would pass every deny test
 * vacuously).
 */

vi.mock("server-only", () => ({}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>(
    "next/server",
  );
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => {
      void cb();
    },
  };
});

const STATE = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "00000000-0000-0000-0000-000000000001" } },
        error: null,
      }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: {},
  mandateAutoSaveLimiter: {},
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
}));

vi.mock("@/lib/audit", () => ({
  logAuditEvent: vi.fn(),
}));

// NOTE: @/lib/csrf is intentionally NOT mocked — the real
// assertSameOrigin is what's under test here.

function makeRequest(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3000/api/preferences", {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ max_weight: 0.25 }),
  });
}

beforeEach(() => {
  STATE.rpcCalls = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/preferences — real CSRF gate (H-0293)", () => {
  it("rejects a forged cross-origin request with 403 (real assertSameOrigin)", async () => {
    const { PUT } = await import("./route");
    // A cross-origin attacker sets a plausible Origin pointing at THEIR
    // host. The real assertSameOrigin resolves the host and finds it is
    // not in ALLOWED_HOSTS → 403. If assertSameOrigin ever stopped
    // inspecting Origin, this request would slip through to the RPC.
    const res = await PUT(makeRequest({ origin: "https://evil.example.com" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Origin not allowed");
    // The mutating RPC must never fire on a CSRF-rejected request.
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("rejects a request with NO Origin and NO Referer with 403 (real assertSameOrigin)", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(makeRequest({}));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Missing Origin or Referer header");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("rejects a request with a malformed Origin header with 403 (real assertSameOrigin)", async () => {
    const { PUT } = await import("./route");
    const res = await PUT(makeRequest({ origin: "not-a-url" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Invalid Origin header");
    expect(STATE.rpcCalls).toHaveLength(0);
  });

  it("admits a legitimate same-origin (localhost) request — gate does not over-block", async () => {
    // localhost:3000 is allow-listed in non-production (vitest NODE_ENV
    // is not 'production'). This proves the deny tests above are not
    // passing vacuously against an always-403 stub: a valid Origin
    // reaches the RPC.
    const { PUT } = await import("./route");
    const res = await PUT(makeRequest({ origin: "http://localhost:3000" }));
    expect(res.status).toBe(200);
    expect(
      STATE.rpcCalls.some((c) => c.name === "update_allocator_mandates"),
    ).toBe(true);
  });
});
