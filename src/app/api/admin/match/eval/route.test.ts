import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * M-0277 (testgap API2) — route-level coverage for
 * GET /api/admin/match/eval, the MatchEvalDashboard data source. Asserts:
 *   1. CSRF — off-origin probe rejected with 403 BEFORE auth.
 *   2. AuthZ — null user → 401; authenticated non-admin → 403.
 *   3. Defaults — lookback_days defaults to "28" when the query param is
 *      omitted; partner_tag is undefined (not "" / null) when omitted.
 *   4. Passthrough — provided lookback_days + partner_tag reach evalMatch.
 *   5. 500 — evalMatch Error → message surfaced; non-Error → "Unknown error".
 *
 * Mirrors the sibling allocators/route.test.ts mocking pattern.
 */

vi.mock("server-only", () => ({}));

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const userState = vi.hoisted<{ current: { id: string } | null }>(() => ({
  current: null,
}));
const adminFlag = vi.hoisted(() => ({ isAdmin: false }));

const evalState = vi.hoisted(() => ({
  lastArgs: null as { lookback_days: string; partner_tag: string | undefined } | null,
  // when set, evalMatch rejects with this value (Error or non-Error).
  throwValue: null as unknown,
  result: { rows: [] } as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: userState.current },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/lib/admin", () => ({
  isAdminUser: async () => adminFlag.isAdmin,
}));

vi.mock("@/lib/analytics-client", () => ({
  evalMatch: async (args: {
    lookback_days: string;
    partner_tag: string | undefined;
  }) => {
    evalState.lastArgs = args;
    if (evalState.throwValue !== null) {
      throw evalState.throwValue;
    }
    return evalState.result;
  },
}));

function makeReq(
  query = "",
  headers: Record<string, string> = VALID_ORIGIN,
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/match/eval${query}`,
    { method: "GET", headers },
  );
}

describe("GET /api/admin/match/eval (M-0277)", () => {
  beforeEach(() => {
    userState.current = null;
    adminFlag.isAdmin = false;
    evalState.lastArgs = null;
    evalState.throwValue = null;
    evalState.result = { rows: [] };
    vi.resetModules();
  });

  it("rejects an off-origin request with 403 BEFORE auth (CSRF guard)", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { GET } = await import("./route");
    const res = await GET(
      makeReq("", { origin: "https://evil.example.com" }),
    );
    expect(res.status).toBe(403);
    expect(evalState.lastArgs).toBeNull();
  });

  it("returns 401 when there is no authenticated user", async () => {
    userState.current = null;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    expect(evalState.lastArgs).toBeNull();
  });

  it("returns 403 when the authenticated caller is not an admin", async () => {
    userState.current = { id: "user-1" };
    adminFlag.isAdmin = false;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Forbidden");
    expect(evalState.lastArgs).toBeNull();
  });

  it("defaults lookback_days to '28' and partner_tag to undefined when the query is omitted", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    expect(evalState.lastArgs).toEqual({
      lookback_days: "28",
      partner_tag: undefined,
    });
  });

  it("passes provided lookback_days and partner_tag through to evalMatch", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    const { GET } = await import("./route");
    const res = await GET(
      makeReq("?lookback_days=90&partner_tag=acme"),
    );
    expect(res.status).toBe(200);
    expect(evalState.lastArgs).toEqual({
      lookback_days: "90",
      partner_tag: "acme",
    });
  });

  it("returns 500 with the upstream Error message when evalMatch throws an Error", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    evalState.throwValue = new Error("analytics service unavailable");
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("analytics service unavailable");
  });

  it("returns 500 with 'Unknown error' when evalMatch throws a non-Error value", async () => {
    userState.current = { id: "admin-1" };
    adminFlag.isAdmin = true;
    evalState.throwValue = "string rejection, not an Error";
    const { GET } = await import("./route");
    const res = await GET(makeReq());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Unknown error");
  });
});
