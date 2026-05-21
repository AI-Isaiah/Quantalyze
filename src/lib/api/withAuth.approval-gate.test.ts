/**
 * PR #266 red-team fix — withAuth must block pending-approval users.
 *
 * Before this gate landed, the universal signup-approval check ran only
 * in the dashboard layout + onboarding page. A pending-approval session
 * could still curl any `/api/*` endpoint behind `withAuth` because the
 * wrapper stopped at `auth.getUser()`. These tests pin the new behaviour
 * in two layers:
 *
 *   1. `assertProfileApproved` (the gate helper) returns 403 for pending,
 *      null for approved, 403 for missing profile — tested directly
 *      against the real implementation.
 *   2. `withAuth` propagates the gate's result — tested against a stubbed
 *      gate so we don't reach the underlying profile query.
 *
 * The global test-setup file (src/test-setup.ts) auto-mocks the gate to
 * return null for ALL other tests; this file overrides per-test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const getUserMock = vi.fn();
const profileSelectMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => profileSelectMock(),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

// Per-test toggle for the gate. The global mock in test-setup.ts returns
// `null` unconditionally; we override here so each test can pick the gate
// result it needs.
const gateMock = vi.fn();
vi.mock("@/lib/api/approval-gate", () => ({
  assertProfileApproved: (...args: unknown[]) => gateMock(...args),
}));

const TEST_USER = { id: "u-1", email: "u-1@example.com" } as const;

function mkReq(method = "POST") {
  return new NextRequest(new URL("http://localhost/api/test"), { method });
}

function mkOkHandler() {
  return vi
    .fn()
    .mockResolvedValue(NextResponse.json({ ok: true }, { status: 200 }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue({ data: { user: TEST_USER } });
  // Default: gate passes (mirrors the global test-setup default).
  gateMock.mockResolvedValue(null);
});

describe("withAuth — approval-gate boundary (PR #266 fix)", () => {
  it("403s when the gate returns a denied response", async () => {
    const denied = NextResponse.json(
      { error: "Account pending approval" },
      { status: 403 },
    );
    gateMock.mockResolvedValue(denied);
    const { withAuth } = await import("./withAuth");
    const handler = mkOkHandler();

    const res = await withAuth(handler)(mkReq("POST"));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Account pending approval" });
    expect(handler).not.toHaveBeenCalled();
    expect(gateMock).toHaveBeenCalledWith(expect.anything(), TEST_USER.id);
  });

  it("calls the handler when the gate returns null", async () => {
    gateMock.mockResolvedValue(null);
    const { withAuth } = await import("./withAuth");
    const handler = mkOkHandler();

    const res = await withAuth(handler)(mkReq("POST"));

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("requireApproval: false skips the gate entirely", async () => {
    const denied = NextResponse.json({ error: "denied" }, { status: 403 });
    gateMock.mockResolvedValue(denied);
    const { withAuth } = await import("./withAuth");
    const handler = mkOkHandler();

    const res = await withAuth(handler, { requireApproval: false })(
      mkReq("POST"),
    );

    expect(res.status).toBe(200);
    expect(gateMock).not.toHaveBeenCalled();
  });
});

describe("assertProfileApproved — direct unit test against the real helper", () => {
  it("returns null for an approved allocator profile", async () => {
    profileSelectMock.mockResolvedValue({
      data: {
        role: "allocator",
        allocator_status: "verified",
        manager_status: null,
        is_admin: false,
      },
    });
    const actual = await vi.importActual<typeof import("./approval-gate")>(
      "./approval-gate",
    );
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const res = await actual.assertProfileApproved(supabase, TEST_USER.id);
    expect(res).toBeNull();
  });

  it("returns 403 for a pending profile", async () => {
    profileSelectMock.mockResolvedValue({
      data: {
        role: "allocator",
        allocator_status: "newbie",
        manager_status: null,
        is_admin: false,
      },
    });
    const actual = await vi.importActual<typeof import("./approval-gate")>(
      "./approval-gate",
    );
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const res = await actual.assertProfileApproved(supabase, TEST_USER.id);
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "Account pending approval" });
  });

  it("admin override: is_admin=true returns null even for pending statuses", async () => {
    profileSelectMock.mockResolvedValue({
      data: {
        role: "allocator",
        allocator_status: "newbie",
        manager_status: null,
        is_admin: true,
      },
    });
    const actual = await vi.importActual<typeof import("./approval-gate")>(
      "./approval-gate",
    );
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const res = await actual.assertProfileApproved(supabase, TEST_USER.id);
    expect(res).toBeNull();
  });

  it("returns 403 when the profile row is missing", async () => {
    profileSelectMock.mockResolvedValue({ data: null });
    const actual = await vi.importActual<typeof import("./approval-gate")>(
      "./approval-gate",
    );
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const res = await actual.assertProfileApproved(supabase, TEST_USER.id);
    expect(res?.status).toBe(403);
  });

  it("role='both' with only one side verified is still blocked", async () => {
    profileSelectMock.mockResolvedValue({
      data: {
        role: "both",
        allocator_status: "verified",
        manager_status: "pending",
        is_admin: false,
      },
    });
    const actual = await vi.importActual<typeof import("./approval-gate")>(
      "./approval-gate",
    );
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const res = await actual.assertProfileApproved(supabase, TEST_USER.id);
    expect(res?.status).toBe(403);
  });
});
