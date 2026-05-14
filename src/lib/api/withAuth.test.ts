/**
 * audit-2026-05-07 round-2 Block D / P1947 — the 401 returned by withAuth
 * when there's no auth session must carry Cache-Control: private, no-store.
 * Two prior audit findings called this out: the route-level comments on
 * /api/allocator/scenario/commit and /api/strategies/browse claim "every
 * response carries no-store," but until this change the 401 from withAuth
 * leaked without the header.
 */

import { describe, it, expect, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: null } }),
    },
  }),
}));

// Bypass CSRF for the unauth path — origin policy is not what we're testing.
vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

import { withAuth } from "./withAuth";

function mkReq(method: string) {
  return new NextRequest(new URL("http://localhost/api/test"), { method });
}

describe("withAuth — 401 path", () => {
  it("returns 401 + Cache-Control private, no-store when no session", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue(NextResponse.json({}, { status: 200 }));
    const wrapped = withAuth(handler);
    const res = await wrapped(mkReq("GET"));

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(handler).not.toHaveBeenCalled();
  });
});
