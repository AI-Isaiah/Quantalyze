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

/**
 * Sprint 6 closeout Task 7.3 plan invariants — signed URL TTL + rate
 * limit + envelope shape.
 *
 * The happy-path response must:
 *   1. Pass `SIGNED_URL_EXPIRY_SECONDS` (3600 = 1 hour) as the TTL to
 *      `createSignedUrl`. A drift to a longer TTL widens the window an
 *      attacker who steals the URL can exfil with.
 *   2. Return `expires_at` in the envelope that is within a second of
 *      now + 1 hour (the route computes it as
 *      `new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000)`).
 *   3. Return the signed URL in the envelope body (NOT inline JSON —
 *      the 100MB cap makes inline infeasible, and the plan spec says
 *      "streams via signed URL").
 *   4. Emit `account.export` audit event with the expected shape.
 *
 * The 429 rate-limit path must:
 *   5. Return 429 when the `exportLimiter` token is exhausted.
 *   6. Return a `Retry-After` header matching the limiter's retryAfter.
 *   7. Short-circuit BEFORE calling `collectUserExportBundle` or
 *      `upload`, so a rate-limited caller doesn't waste the expensive
 *      bundle assembly.
 */
describe("POST /api/account/export — signed URL TTL + envelope (spec invariants)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-ttl", email: "ttl@test.com" } },
    });
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    collectBundleMock.mockResolvedValue({
      schema_version: 1,
      user_id: "user-ttl",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 3,
      tables: [
        { table: "profiles", rows: [{ id: "user-ttl" }], row_count: 1, truncated_at_cap: false },
        { table: "api_keys", rows: [{ id: "k1" }, { id: "k2" }], row_count: 2, truncated_at_cap: false },
      ],
      truncated_at_size_cap: false,
    });
    uploadMock.mockResolvedValue({ error: null });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://example.supabase.co/storage/v1/object/sign/gdpr-exports/user-ttl/abc.json?token=XYZ" },
      error: null,
    });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("passes SIGNED_URL_EXPIRY_SECONDS = 3600 (1h) to createSignedUrl", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    expect(createSignedUrlMock).toHaveBeenCalledTimes(1);
    // Second positional argument is the TTL in seconds.
    const ttlSeconds = createSignedUrlMock.mock.calls[0][1];
    expect(ttlSeconds).toBe(60 * 60);
  });

  it("returns an envelope with signed_url + expires_at ≈ now + 1h (no inline bundle)", async () => {
    const { POST } = await loadRoute();
    const beforeMs = Date.now();
    const res = await POST(makeRequest());
    const afterMs = Date.now();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      ok: boolean;
      signed_url: string;
      expires_at: string;
      bytes: number;
      table_count: number;
      total_row_count: number;
      truncated_at_size_cap: boolean;
      // The envelope MUST NOT carry the bundle inline.
      tables?: unknown;
      rows?: unknown;
    };

    expect(body.ok).toBe(true);
    expect(body.signed_url).toMatch(/^https:\/\/.+\/storage\/v1\/object\/sign\/gdpr-exports\//);
    expect(body.total_row_count).toBe(3);
    expect(body.table_count).toBe(2);
    expect(body.truncated_at_size_cap).toBe(false);
    expect(typeof body.bytes).toBe("number");

    // Expires ~1h from now: within [before+3599s, after+3601s] window.
    const expiresMs = new Date(body.expires_at).getTime();
    expect(expiresMs).toBeGreaterThanOrEqual(beforeMs + 3599 * 1000);
    expect(expiresMs).toBeLessThanOrEqual(afterMs + 3601 * 1000);

    // The envelope is the URL, not the data. An inline bundle would
    // violate the 100MB cap contract.
    expect(body.tables).toBeUndefined();
    expect(body.rows).toBeUndefined();
  });

  it("emits account.export audit event with storage_path + expires_at + table_count + total_row_count", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);

    // audit.ts schedules via after()/queueMicrotask — drain.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(logAuditRpcMock).toHaveBeenCalled();
    const call = logAuditRpcMock.mock.calls.find(
      (c) => c[0] === "log_audit_event" && c[1]?.p_action === "account.export",
    );
    expect(call).toBeDefined();
    const args = call![1] as Record<string, unknown>;
    expect(args.p_entity_type).toBe("user");
    expect(args.p_entity_id).toBe("user-ttl");
    const metadata = args.p_metadata as Record<string, unknown>;
    expect(typeof metadata.storage_path).toBe("string");
    expect((metadata.storage_path as string).startsWith("user-ttl/")).toBe(true);
    expect(typeof metadata.expires_at).toBe("string");
    expect(metadata.table_count).toBe(2);
    expect(metadata.total_row_count).toBe(3);
    expect(metadata.truncated_at_size_cap).toBe(false);
  });
});

describe("POST /api/account/export — 1/day rate limit (429 path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-429", email: "rl@test.com" } },
    });
    // Default: NOT rate-limited; each test overrides for the 429 case.
    checkLimitMock.mockResolvedValue({ success: true, retryAfter: 0 });
    collectBundleMock.mockResolvedValue({
      schema_version: 1,
      user_id: "user-429",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 0,
      tables: [],
      truncated_at_size_cap: false,
    });
    uploadMock.mockResolvedValue({ error: null });
    createSignedUrlMock.mockResolvedValue({
      data: { signedUrl: "https://example.com/sign" },
      error: null,
    });
    logAuditRpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("returns 429 with Retry-After header when the exportLimiter token is spent", async () => {
    // 86400s = 24h; matches exportLimiter = makeLimiter(1, "86400 s").
    checkLimitMock.mockResolvedValueOnce({
      success: false,
      retryAfter: 86_400,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);

    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/export limit|limit reached|try again/i);

    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).toBe("86400");
  });

  it("429 short-circuits before collectUserExportBundle or upload (wasted-compute guard)", async () => {
    checkLimitMock.mockResolvedValueOnce({
      success: false,
      retryAfter: 3600,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeRequest());
    expect(res.status).toBe(429);

    // The expensive bundle assembly must NOT have run — otherwise a
    // rate-limited caller could DOS-amplify by waiting 0ms between
    // retries. The order-of-operations in route.ts is:
    //   csrf → auth → rate-limit → collectBundle → upload → sign
    // Any move of the rate-limit check below collectBundle would fail
    // this test.
    expect(collectBundleMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).not.toHaveBeenCalled();
  });

  it("the limiter key buckets per user (not global) — different users each get 1/day", async () => {
    // First call for user-A: token available.
    getUserMock.mockResolvedValueOnce({
      data: { user: { id: "user-A", email: "a@x" } },
    });
    const { POST } = await loadRoute();
    const resA = await POST(makeRequest());
    expect(resA.status).toBe(200);
    const keyArgA = checkLimitMock.mock.calls[0][1] as string;
    expect(keyArgA).toBe("export:user-A");

    // Second call for user-B: different bucket key.
    vi.clearAllMocks();
    assertSameOriginMock.mockReturnValue(null);
    getUserMock.mockResolvedValue({
      data: { user: { id: "user-B", email: "b@x" } },
    });
    checkLimitMock.mockResolvedValueOnce({ success: true, retryAfter: 0 });
    collectBundleMock.mockResolvedValueOnce({
      schema_version: 1,
      user_id: "user-B",
      generated_at: "2026-04-16T00:00:00Z",
      total_row_count: 0,
      tables: [],
      truncated_at_size_cap: false,
    });
    uploadMock.mockResolvedValueOnce({ error: null });
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: "https://example.com/sign" },
      error: null,
    });
    const { POST: POST_B } = await loadRoute();
    const resB = await POST_B(makeRequest());
    expect(resB.status).toBe(200);
    const keyArgB = checkLimitMock.mock.calls[0][1] as string;
    expect(keyArgB).toBe("export:user-B");
  });
});
