/**
 * audit-2026-05-07 round-2 Block D / P1946 — unit tests for withAllocatorAuth.
 *
 * The helper composes `withAuth`. The wrapped handler must only fire when:
 *   - withAuth admitted the request (auth session present), AND
 *   - profiles.role for that user is in ('allocator', 'both').
 *
 * The three failure paths each carry Cache-Control: private, no-store and
 * each returns a distinct status + message so triage doesn't conflate them:
 *   - profile lookup error → 503 ("Profile lookup failed")
 *   - profile row missing  → 403 ("Profile not provisioned")
 *   - role not allocator   → 403 ("Forbidden — allocator role required")
 *
 * We also exercise `role='both'` and `role='manager'` to pin the boundary
 * the role-IN check creates.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("server-only", () => ({}));

// withAuth is the wrapper our helper composes; mock it to a pass-through that
// always supplies a fixed test user. Auth-failure cases are already covered by
// withAuth.ts itself — here we only care about the allocator gate.
const MOCK_USER = { id: "user-A" } as unknown as import("@supabase/supabase-js").User;

vi.mock("./withAuth", () => ({
  withAuth:
    (h: (req: NextRequest, user: typeof MOCK_USER) => Promise<NextResponse>) =>
    (req: NextRequest) =>
      h(req, MOCK_USER),
}));

// The profile lookup mock is the test driver: each case primes the chained
// .from().select().eq().maybeSingle() return.
const maybeSingleMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}));

import { withAllocatorAuth } from "./withAllocatorAuth";

function mkReq(): NextRequest {
  return new NextRequest(new URL("http://localhost/api/test"), {
    method: "GET",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingleMock.mockReset();
});

describe("withAllocatorAuth", () => {
  it("returns 403 'Profile not provisioned' + Cache-Control when the profile row is missing", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

    const handler = vi.fn();
    const wrapped = withAllocatorAuth(handler as never);
    const res = await wrapped(mkReq());

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      error: "Profile not provisioned",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 'allocator role required' when the profile row exists but role='manager'", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { role: "manager" },
      error: null,
    });

    const handler = vi.fn();
    const wrapped = withAllocatorAuth(handler as never);
    const res = await wrapped(mkReq());

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      error: "Forbidden — allocator role required",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 503 + Cache-Control when the profile lookup errors out (not 403)", async () => {
    // Silent-failure round-1 fix: a DB blip must NOT surface as 403 with a
    // "you lost your allocator role" message. Caller sees 503 (retry) and
    // SRE sees a Sentry breadcrumb.
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "boom", code: "PGRST000" },
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const handler = vi.fn();
    const wrapped = withAllocatorAuth(handler as never);
    const res = await wrapped(mkReq());

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({ error: "Profile lookup failed" });
    expect(handler).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      "[withAllocatorAuth] profile lookup failed:",
      expect.objectContaining({
        user_id: "user-A",
        code: "PGRST000",
        message: "boom",
      }),
    );
    consoleSpy.mockRestore();
  });

  it("invokes the inner handler with (req, user) when role='allocator'", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { role: "allocator" },
      error: null,
    });
    const handler = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));

    const wrapped = withAllocatorAuth(handler);
    const req = mkReq();
    const res = await wrapped(req);

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    const [reqArg, userArg] = handler.mock.calls[0];
    expect(reqArg).toBe(req);
    expect(userArg).toBe(MOCK_USER);
  });

  it("invokes the inner handler when role='both' (manager+allocator)", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { role: "both" },
      error: null,
    });
    const handler = vi
      .fn()
      .mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));

    const wrapped = withAllocatorAuth(handler);
    const res = await wrapped(mkReq());

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
