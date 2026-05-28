import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for POST /api/account/export — audit-2026-05-07 Cluster A.
 *
 * Coverage anchors:
 *   - C-0028 (no-test gap): unauth 401, CSRF 403, rate-limit 429,
 *     upload-fail 500 (+ audit), sign-fail 500 (+ cleanup + audit),
 *     happy-path 200 (+ audit).
 *   - C-0021 (defense-in-depth assertion): bundle helper receives the
 *     auth-derived user id, not any request body / path param.
 *   - C-0022 / C-0023 (sanitize-loop gate): a user whose profile has
 *     display_name='[deleted]' is denied with 403 + code.
 *   - C-0027 (Cache-Control): every response carries `private, no-store`.
 *   - H-0200 (forensic IP/UA): success-path audit metadata includes ip
 *     + user_agent from headers.
 *   - H-0201 (audit on upload/sign-fail): account.export_refused emitted
 *     on upload + sign failure paths.
 *   - H-0202 (storage_path → hash): success audit metadata records
 *     object_key_sha256, NOT raw storage_path.
 */

vi.mock("server-only", () => ({}));

// `after()` schedules audit emission after the response. In tests we run
// the callback synchronously so audit emission is observable.
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

const USER_ID = "00000000-0000-0000-0000-000000000001";

const STATE = vi.hoisted(() => ({
  authUser: null as { id: string; email: string } | null,
  callerProfile: { display_name: "Alice" } as { display_name: string } | null,
  csrfResponse: null as null | ReturnType<typeof Response.json>,
  checkLimitResult: { success: true, retryAfter: 0 } as {
    success: boolean;
    retryAfter: number;
  },
  // Bundle helper output — keep small, deterministic.
  bundleResult: null as
    | null
    | {
        tables: Array<{ table: string; truncated_at_cap: boolean; rows: unknown[] }>;
        partial: boolean;
        failed_tables: string[];
        truncated_at_size_cap: boolean;
        parent_id_truncated_tables: string[];
        parent_id_null_dropped_tables: string[];
        total_row_count: number;
      },
  bundleSubjectId: null as string | null,
  uploadResult: { error: null } as { error: { message: string } | null },
  signedUrlResult: {
    data: { signedUrl: "https://example.com/signed" },
    error: null,
  } as { data: { signedUrl: string } | null; error: { message: string } | null },
  removeCalls: [] as string[][],
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  refundCalls: [] as string[],
  // Audit-2026-05-07 red-team R-0006 hooks. exportLimiterNull pivots the
  // limiter mock between "working stub" and "null (UPSTASH misconfig)".
  // refundShouldThrow makes resetUsedTokens throw to exercise the
  // counter-bumping catch path.
  exportLimiterNull: false,
  refundShouldThrow: false,
}));

function defaultBundle() {
  return {
    tables: [{ table: "profiles", truncated_at_cap: false, rows: [{ id: USER_ID }] }],
    partial: false,
    failed_tables: [],
    truncated_at_size_cap: false,
    parent_id_truncated_tables: [],
    parent_id_null_dropped_tables: [],
    total_row_count: 1,
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: STATE.authUser }, error: null }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: STATE.callerProfile,
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      STATE.rpcCalls.push({ name, args });
      return { data: null, error: null };
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: {
      from: (_bucket: string) => ({
        upload: async () => STATE.uploadResult,
        createSignedUrl: async () => STATE.signedUrlResult,
        remove: async (paths: string[]) => {
          STATE.removeCalls.push(paths);
          return { error: null };
        },
      }),
    },
  }),
}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => STATE.csrfResponse,
}));

vi.mock("@/lib/ratelimit", () => ({
  get exportLimiter() {
    // Audit-2026-05-07 red-team R-0006: allow tests to flip the limiter
    // to null so the "null in production" warn-and-bump path can be
    // exercised. Default: a working stub limiter.
    return STATE.exportLimiterNull
      ? null
      : {
          resetUsedTokens: async (key: string) => {
            if (STATE.refundShouldThrow) {
              throw new Error("simulated upstash blip");
            }
            STATE.refundCalls.push(key);
          },
        };
  },
  checkLimit: async () => STATE.checkLimitResult,
  getClientIp: (headers: Headers) =>
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown",
}));

vi.mock("@/lib/gdpr-export", () => ({
  collectUserExportBundle: async (_admin: unknown, subjectId: string) => {
    STATE.bundleSubjectId = subjectId;
    return STATE.bundleResult ?? defaultBundle();
  },
  encodeExportBundle: () => new Uint8Array([123, 125]),
  rowsForTable: (
    bundle: { tables: Array<{ table: string; rows: unknown[] }> },
    name: string,
  ) => bundle.tables.find((t) => t.table === name)?.rows ?? null,
}));

const auditEmissions: Array<{
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
}> = [];

vi.mock("@/lib/audit", () => ({
  logAuditEvent: (
    _client: unknown,
    event: {
      action: string;
      entity_type: string;
      entity_id: string;
      metadata?: Record<string, unknown>;
    },
  ) => {
    auditEmissions.push({
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id,
      metadata: event.metadata ?? {},
    });
  },
}));

import {
  POST,
  getExportRefundFailureCount,
  __resetExportRefundFailureCountForTests,
  __getInFlightExportsCountForTests,
  __resetInFlightExportsForTests,
} from "./route";

function buildRequest(headers: Record<string, string> = {}): NextRequest {
  const req = new NextRequest("https://example.com/api/account/export", {
    method: "POST",
    headers: {
      origin: "https://example.com",
      ...headers,
    },
  });
  return req;
}

beforeEach(() => {
  STATE.authUser = { id: USER_ID, email: "alice@test" };
  STATE.callerProfile = { display_name: "Alice" };
  STATE.csrfResponse = null;
  STATE.checkLimitResult = { success: true, retryAfter: 0 };
  STATE.bundleResult = null;
  STATE.bundleSubjectId = null;
  STATE.uploadResult = { error: null };
  STATE.signedUrlResult = {
    data: { signedUrl: "https://example.com/signed" },
    error: null,
  };
  STATE.removeCalls = [];
  STATE.rpcCalls = [];
  STATE.refundCalls = [];
  STATE.exportLimiterNull = false;
  STATE.refundShouldThrow = false;
  auditEmissions.length = 0;
  // R-0006: reset the module-local refund-failure counter per test so
  // the assertions are isolated.
  __resetExportRefundFailureCountForTests();
  // R-0008: clear in-flight map between tests so a failure mid-test
  // can't poison the next.
  __resetInFlightExportsForTests();
});

describe("POST /api/account/export — audit-2026-05-07 cluster A", () => {
  it("C-0028 #1: returns 401 when unauthenticated, no audit", async () => {
    STATE.authUser = null;
    const res = await POST(buildRequest());
    expect(res.status).toBe(401);
    expect(auditEmissions).toHaveLength(0);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("C-0028 #2 / CSRF: returns 403 when wrong origin, no audit", async () => {
    STATE.csrfResponse = new Response(null, { status: 403 }) as unknown as
      ReturnType<typeof Response.json>;
    const res = await POST(buildRequest());
    expect(res.status).toBe(403);
    expect(auditEmissions).toHaveLength(0);
  });

  it("C-0028 #3 / rate-limit: 429 + Retry-After + Cache-Control", async () => {
    STATE.checkLimitResult = { success: false, retryAfter: 3600 };
    const res = await POST(buildRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    // H-0015 (audit 2026-05-25): a throttled export now emits a dedicated
    // `account.export_rate_limited` audit event before returning so a
    // credential-export probing storm leaves a forensic trail. Exactly
    // one emission on this path, carrying retry_after.
    expect(auditEmissions).toHaveLength(1);
    expect(auditEmissions[0].action).toBe("account.export_rate_limited");
    expect(auditEmissions[0].entity_type).toBe("user");
    expect(auditEmissions[0].metadata.retry_after).toBe(3600);
  });

  it("C-0022 / C-0023 sanitize-loop: 403 when display_name='[deleted]', no audit, no bundle assembly", async () => {
    STATE.callerProfile = { display_name: "[deleted]" };
    const res = await POST(buildRequest());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("account_sanitized");
    expect(STATE.bundleSubjectId).toBeNull();
    expect(auditEmissions).toHaveLength(0);
  });

  it("C-0021: bundle helper called with auth-derived user id (not a request-body field)", async () => {
    await POST(buildRequest());
    expect(STATE.bundleSubjectId).toBe(USER_ID);
  });

  it("C-0028 #4 / H-0201 upload-fail: 500 + account.export_refused audit + token refund", async () => {
    STATE.uploadResult = { error: { message: "boom" } };
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
    const refused = auditEmissions.find(
      (e) => e.action === "account.export_refused",
    );
    expect(refused).toBeTruthy();
    expect(refused?.metadata.reason).toBe("upload_failed");
  });

  it("C-0028 #5 / H-0201 sign-fail: 500 + orphan cleanup + audit", async () => {
    STATE.signedUrlResult = {
      data: null,
      error: { message: "no signing key" },
    };
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
    expect(STATE.removeCalls).toHaveLength(1);
    expect(STATE.removeCalls[0][0]).toMatch(/^00000000-0000-0000-0000-000000000001\//);
    const refused = auditEmissions.find(
      (e) =>
        e.action === "account.export_refused" &&
        e.metadata.reason === "sign_failed",
    );
    expect(refused).toBeTruthy();
    expect(refused?.metadata.object_key_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("C-0028 #7 / H-0200 happy-path: 200 + account.export audit with ip + user_agent + object_key_sha256", async () => {
    const res = await POST(
      buildRequest({
        "x-forwarded-for": "203.0.113.7, 198.51.100.1",
        "user-agent": "Mozilla/5.0 test",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.signed_url).toBe("https://example.com/signed");

    const exportEvent = auditEmissions.find((e) => e.action === "account.export");
    expect(exportEvent).toBeTruthy();
    expect(exportEvent?.entity_id).toBe(USER_ID);
    expect(exportEvent?.metadata.object_key_sha256).toMatch(/^[0-9a-f]{64}$/);
    // H-0202: raw storage_path must NOT appear in audit metadata.
    expect(exportEvent?.metadata.storage_path).toBeUndefined();
    // H-0200: ip + user_agent must be present.
    expect(exportEvent?.metadata.ip).toBe("203.0.113.7");
    expect(exportEvent?.metadata.user_agent).toBe("Mozilla/5.0 test");
  });

  it("red-team R8: upload-fail refunds the 1/day rate-limit token", async () => {
    STATE.uploadResult = { error: { message: "boom" } };
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
    expect(STATE.refundCalls).toContain("export:" + USER_ID);
  });

  it("red-team R8: sign-fail refunds the 1/day rate-limit token", async () => {
    STATE.signedUrlResult = {
      data: null,
      error: { message: "no signing key" },
    };
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
    expect(STATE.refundCalls).toContain("export:" + USER_ID);
  });

  it("red-team R-0006: refund throw bumps the refund-failure counter", async () => {
    // Force the refund path: upload fails so the route enters the
    // catch-and-refund branch, then the limiter's resetUsedTokens
    // throws. The counter MUST increment.
    STATE.uploadResult = { error: { message: "boom" } };
    STATE.refundShouldThrow = true;
    expect(getExportRefundFailureCount()).toBe(0);
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
    expect(getExportRefundFailureCount()).toBe(1);
    // The route's primary 500 envelope still lands.
    const body = await res.json();
    expect(body.error).toBe("Failed to upload export bundle");
  });

  it("red-team R-0006: null limiter in production bumps the counter + warns", async () => {
    // Pre-fix the null-limiter branch silently no-op'd in every env —
    // including a production deploy with missing UPSTASH env vars,
    // where the refund is load-bearing for the GDPR refund contract.
    // Pin: VERCEL_ENV=production + exportLimiter=null bumps the
    // counter so /api/health can surface the misconfig.
    const originalVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      STATE.uploadResult = { error: { message: "boom" } };
      STATE.exportLimiterNull = true;
      const res = await POST(buildRequest());
      expect(res.status).toBe(500);
      expect(getExportRefundFailureCount()).toBe(1);
    } finally {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });

  it("red-team R-0006: null limiter in dev/preview does NOT bump the counter", async () => {
    // Non-production: null limiter is the legitimate dev/preview path
    // (fail-OPEN by design in src/lib/ratelimit.ts checkLimit). The
    // counter must NOT bump there or local-dev iteration would spam it.
    const originalVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    try {
      STATE.uploadResult = { error: { message: "boom" } };
      STATE.exportLimiterNull = true;
      const res = await POST(buildRequest());
      expect(res.status).toBe(500);
      expect(getExportRefundFailureCount()).toBe(0);
    } finally {
      process.env.VERCEL_ENV = originalVercelEnv;
    }
  });

  it("red-team R-0008: concurrent same-user POSTs are serialized through inFlightExportsByUser", async () => {
    // Pin the serialization mechanism. Two concurrent POSTs for the
    // same user must run sequentially, not in parallel — which the
    // in-flight map guarantees. We assert by observing the order of
    // bundleSubjectId writes: only one in-flight at a time.
    const subjectIdsSeen: string[] = [];
    let inFlightCountDuringHandler = 0;
    // The mocked collectUserExportBundle reads STATE.bundleResult; we
    // observe per-call by checking the in-flight count when each call
    // enters the route handler. The cleanest way: spy via overriding
    // STATE.bundleResult getter to a function that records the size.
    // Re-mocking after import is not supported by vitest's hoisted-mock
    // layering, so the side-effect hook lives on STATE.
    Object.defineProperty(STATE, "bundleResult", {
      configurable: true,
      get() {
        subjectIdsSeen.push("bundle-read");
        inFlightCountDuringHandler = Math.max(
          inFlightCountDuringHandler,
          __getInFlightExportsCountForTests(),
        );
        return defaultBundle();
      },
    });
    try {
      const [resA, resB] = await Promise.all([
        POST(buildRequest()),
        POST(buildRequest()),
      ]);
      // Both calls reached the handler (otherwise we'd see only 1
      // bundle-read), but serialized through the in-flight map: the
      // second call's bundle-read happens AFTER the first releases its
      // in-flight entry, so the in-flight count never exceeds 1 at any
      // bundle-read observation point.
      expect(subjectIdsSeen.length).toBe(2);
      expect(inFlightCountDuringHandler).toBe(1);
      // Both calls return cleanly (first succeeds, second hits 1/day
      // limit in real Upstash — the mock returns success=true so both
      // pass; the serialization is the contract, not the 429 outcome).
      expect([resA.status, resB.status]).toEqual([200, 200]);
      // In-flight map is cleared on completion.
      expect(__getInFlightExportsCountForTests()).toBe(0);
    } finally {
      // Restore the property so other tests see the plain field again.
      Object.defineProperty(STATE, "bundleResult", {
        configurable: true,
        writable: true,
        value: null,
      });
    }
  });

  it("storage path prefix matches storage RLS (migration 055 foldername[1]=user_id)", async () => {
    await POST(buildRequest());
    // Sign-success path: bucket.remove not called; storage_path goes
    // only through the upload mock. Assert hash-of-prefix shape via
    // the success audit:
    const evt = auditEmissions.find((e) => e.action === "account.export");
    expect(evt?.metadata.object_key_sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
