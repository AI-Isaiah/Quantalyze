/**
 * audit-2026-05-07 round-2 Block D / P1946 — unit tests for withAllocatorAuth.
 *
 * The helper composes `withAuth`. The wrapped handler must only fire when:
 *   - withAuth admitted the request (auth session present), AND
 *   - profiles.role for that user is in ('allocator', 'both').
 *
 * Every other path returns 403 with Cache-Control: private, no-store, and the
 * inner handler is never invoked.
 *
 * The plan-text spec covers three cases (profile missing, non-allocator role,
 * allocator passes). We add `role='both'` and `role='manager'` to exercise
 * the boundary the role-IN check creates.
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
  it("returns 403 + Cache-Control when the profile row is missing", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });

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

  it("returns 403 when the profile row exists but role='manager'", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { role: "manager" },
      error: null,
    });

    const handler = vi.fn();
    const wrapped = withAllocatorAuth(handler as never);
    const res = await wrapped(mkReq());

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 403 when the profile lookup errors out", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: null,
      error: { message: "boom", code: "PGRST000" },
    });

    const handler = vi.fn();
    const wrapped = withAllocatorAuth(handler as never);
    const res = await wrapped(mkReq());

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(handler).not.toHaveBeenCalled();
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
