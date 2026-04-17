/**
 * Sprint 6 closeout Task 7.3 code-review fix I2 — POST
 * /api/account/export must remove the uploaded storage object if
 * createSignedUrl fails. Otherwise the object is orphaned forever
 * (1-per-day rate limit means the user can't retry with upsert:true to
 * overwrite).
 *
 * Scope
 * -----
 * This file tests the route's error-handling path with a mocked
 * Supabase storage stack. The happy-path behavior (upload + sign +
 * audit + envelope response) is already exercised by the integration
 * test in gdpr-export.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const {
  getUserMock,
  assertSameOriginMock,
  checkLimitMock,
  uploadMock,
  createSignedUrlMock,
  removeMock,
  collectBundleMock,
  logAuditRpcMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  assertSameOriginMock: vi.fn<(r: unknown) => Response | null>(() => null),
  checkLimitMock: vi.fn(),
  uploadMock: vi.fn(),
  createSignedUrlMock: vi.fn(),
  removeMock: vi.fn(),
  collectBundleMock: vi.fn(),
  logAuditRpcMock: vi.fn(),
}));

function makeUserClient() {
  return {
    auth: { getUser: getUserMock },
    rpc: logAuditRpcMock,
  };
}

function makeAdminClient() {
  return {
    storage: {
      from: () => ({
        upload: (key: string, body: unknown, opts: unknown) =>
          uploadMock(key, body, opts),
        createSignedUrl: (key: string, ttl: number) =>
          createSignedUrlMock(key, ttl),
        remove: (paths: string[]) => removeMock(paths),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => makeUserClient()),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: (req: unknown) => assertSameOriginMock(req),
}));

vi.mock("@/lib/ratelimit", () => ({
  exportLimiter: {}, // placeholder — checkLimit is the actual gate
  checkLimit: (limiter: unknown, key: string) => checkLimitMock(limiter, key),
}));

vi.mock("@/lib/gdpr-export", () => ({
  collectUserExportBundle: (admin: unknown, userId: string) =>
    collectBundleMock(admin, userId),
}));

import { NextRequest } from "next/server";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/account/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: "{}",
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import("@/app/api/account/export/route");
}

describe("POST /api/account/export — orphan cleanup on sign failure (I2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-123", email: "u@test.com" } },
    });
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    collectBundleMock.mockResolvedValue({
      schema_version: 1,
      user_id: "user-123",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 0,
      tables: [],
      truncated_at_size_cap: false,
    });
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("removes the uploaded object when createSignedUrl returns error", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: null,
      error: { message: "signing backend unavailable" },
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/failed to sign/i);

    // Upload happened (the object exists in bucket at this point)
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const uploadedKey = uploadMock.mock.calls[0][0] as string;
    expect(uploadedKey.startsWith("user-123/")).toBe(true);

    // Cleanup MUST have fired with the exact same key
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(removeMock.mock.calls[0][0]).toEqual([uploadedKey]);
  });

  it("removes the uploaded object when createSignedUrl returns no signedUrl in data", async () => {
    // Supabase client can succeed (no error) but return data without
    // signedUrl on certain backend-partial failures. The cleanup path
    // must handle that too.
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: null },
      error: null,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT re-throw if the cleanup remove() itself fails — the user sees the sign error only", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: null,
      error: { message: "signing backend unavailable" },
    });
    // Cleanup threw — the surface should still be the original sign
    // failure, not a cleanup error.
    removeMock.mockRejectedValue(new Error("remove exploded"));

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/failed to sign/i);
    // The route didn't propagate the remove error
    expect(body.error).not.toMatch(/remove exploded/i);
  });

  it("does NOT remove the object on the happy path (sanity check)", async () => {
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://example.com/signed?t=1" },
      error: null,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    expect(removeMock).not.toHaveBeenCalled();
  });
});
