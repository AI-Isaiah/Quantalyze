/**
 * H-0335 — input-validation coverage for POST /api/verify-strategy.
 *
 * The route exposes four 400 short-circuits (invalid JSON, missing
 * required fields, isValidEmail false, exchange ∉ SUPPORTED_EXCHANGES)
 * and a legacy per-email 429 (MAX_REQUESTS_PER_DAY=5) BEFORE delegating
 * to the unified or legacy handler. Existing coverage
 * (tests/integration/process-key-thin-adapters.test.ts,
 *  tests/integration/phase-19-pra-write.test.ts) only drives the happy
 * path with email='test@example.com' + exchange='okx'. A regression that
 * loosened the email regex, dropped a required field, removed an exchange
 * from SUPPORTED_EXCHANGES, or dropped the daily-cap guard would not be
 * caught. These tests pin each branch.
 *
 * The unified-backbone flag is forced OFF so the legacy handler (which
 * owns the MAX_REQUESTS_PER_DAY guard) is the one under test.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const verifyStrategyMock = vi.fn();
// Daily-cap count returned by the admin verification_requests head/count
// select. Mutated per test to drive the 429 branch.
let verificationCount = 0;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

vi.mock("@/lib/ratelimit", () => ({
  publicIpLimiter: null,
  checkLimit: async () => ({ success: true, retryAfter: 0 }),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/analytics-client", () => {
  // Real-shape error classes so the route's `err instanceof AnalyticsUpstreamError`
  // narrowing resolves against the same constructor identity (F5b R8).
  class AnalyticsUpstreamError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "AnalyticsUpstreamError";
      this.status = status;
    }
  }
  class AnalyticsTimeoutError extends Error {
    constructor(path: string, timeoutMs: number) {
      super(`Analytics request to ${path} timed out after ${timeoutMs}ms`);
      this.name = "AnalyticsTimeoutError";
    }
  }
  return {
    verifyStrategy: verifyStrategyMock,
    AnalyticsUpstreamError,
    AnalyticsTimeoutError,
  };
});

// F5b (R8): spy on captureToSentry so the 5xx-redaction test can pin that the
// internal detail still reaches Sentry now that err.message is no longer echoed.
const captureSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureSpy }));

vi.mock("@/lib/feature-flags", () => ({
  isUnifiedBackboneActive: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      if (table === "verification_requests") {
        return {
          // Daily-cap count path: .select(id,{count,head}).eq().gte()
          select: () => ({
            eq: () => ({
              gte: async () => ({ count: verificationCount, error: null }),
            }),
          }),
          // Legacy public_token UPDATE path.
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        };
      }
      if (table === "strategy_verifications") {
        return {
          upsert: async () => ({ error: null }),
        };
      }
      throw new Error(`unexpected admin table: ${table}`);
    },
  }),
}));

function postReq(body: unknown, raw = false): NextRequest {
  return new NextRequest("http://localhost:3000/api/verify-strategy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
    },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

const VALID_BODY = {
  email: "test@example.com",
  exchange: "okx",
  api_key: "k",
  api_secret: "s",
};

describe("POST /api/verify-strategy — input validation (H-0335)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verificationCount = 0;
    verifyStrategyMock.mockResolvedValue({
      verification_id: "22222222-2222-2222-2222-222222222222",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 400 'Invalid JSON body' when the body is not valid JSON", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq("{not json", true));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  it("returns 400 'Missing required fields' when api_secret is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      postReq({ email: "test@example.com", exchange: "okx", api_key: "k" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Missing required fields");
    // The delegate must never run on a malformed payload.
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  it("returns 400 'Invalid email address' when the email fails the regex", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...VALID_BODY, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid email address");
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  it("returns 400 'Unsupported exchange' when the exchange is not in SUPPORTED_EXCHANGES", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...VALID_BODY, exchange: "kraken" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unsupported exchange");
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the email has already hit MAX_REQUESTS_PER_DAY (5)", async () => {
    // The legacy handler counts verification_requests for this email in
    // the last 24h and refuses at >= 5.
    verificationCount = 5;
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toContain("Rate limit exceeded");
    // The daily cap short-circuits BEFORE the analytics delegate runs.
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  it("admits a valid payload under the daily cap (count < 5) — delegate runs", async () => {
    // Belt-and-braces so the 429 test above can't pass vacuously: a
    // well-formed request under the cap must reach the delegate.
    verificationCount = 4;
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect(verifyStrategyMock).toHaveBeenCalledTimes(1);
  });

  it("F5b (R8) — a 5xx/generic delegate error returns 502 STATIC (no leak) + Sentry", async () => {
    // The thrown message mimics the raw Python traceback / contract-violation
    // string the analytics client surfaces on a 5xx — exactly what must NOT
    // reach the (semi-public) verification caller.
    verificationCount = 0;
    verifyStrategyMock.mockRejectedValue(
      new Error("Traceback: simulator_scoring.py:188 KeyError 'sharpe'"),
    );
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Verification service unavailable. Please try again.");
    expect(body.error).not.toContain("Traceback");
    expect(body.error).not.toContain("simulator_scoring");
    expect(captureSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { route: "api/verify-strategy" } }),
    );
  });

  it("F5b (R8) — a curated 4xx delegate error is forwarded with its status", async () => {
    verificationCount = 0;
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    verifyStrategyMock.mockRejectedValue(
      new AnalyticsUpstreamError("No trades found for this key in the last 90 days", 404),
    );
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    // Curated 4xx detail is user-actionable — it MUST still reach the caller.
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No trades found for this key in the last 90 days");
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("F5b (R8) — a delegate timeout returns 504 STATIC, no Sentry (timeout is upstream-expected)", async () => {
    verificationCount = 0;
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    verifyStrategyMock.mockRejectedValue(
      new AnalyticsTimeoutError("/api/verify-strategy", 30000),
    );
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe("Verification timed out. Please try again.");
    expect(captureSpy).not.toHaveBeenCalled();
  });
});

/**
 * NEW-C35-02 (red-team M conf=8): the unified path MUST persist
 * trust_tier="self_reported" regardless of what the upstream /process-key
 * returns. An unproven landing-page key must never be badged "api_verified".
 *
 * Pre-fix: the update call only wrote `{public_token, expires_at}`, leaving
 * the upstream-set "api_verified" tier in place.
 * Post-fix: the update explicitly writes `trust_tier: "self_reported"` to
 * override whatever the Python backend emitted.
 */
describe("NEW-C35-02 — unified path persists trust_tier=self_reported for teaser", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("update call includes trust_tier=self_reported, overriding upstream api_verified", async () => {
    vi.doMock("@/lib/feature-flags", () => ({
      isUnifiedBackboneActive: vi.fn().mockResolvedValue(true),
    }));

    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: true,
        response: null,
        body: {
          verification_id: "44444444-4444-4444-4444-444444444444",
          status: "published",
          // upstream reports api_verified — the teaser path must override this
          trust_tier: "api_verified",
        },
      }),
    }));

    const updateSpy = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from(table: string) {
          if (table === "strategy_verifications") {
            return { update: updateSpy };
          }
          throw new Error(`unexpected: ${table}`);
        },
      }),
    }));

    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(200);

    // The update must have been called with trust_tier="self_reported"
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const updateArg = updateSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(updateArg.trust_tier).toBe("self_reported");
    // Sanity: public_token and expires_at are still present
    expect(updateArg).toHaveProperty("public_token");
    expect(updateArg).toHaveProperty("expires_at");
  });
});

/**
 * NEW-C35-01 (red-team H conf=8): the unified path MUST NOT spread the raw
 * upstream body into the response. The upstream /process-key teaser response
 * includes `encrypted_credentials` (KEK-wrapped api_key/secret/passphrase),
 * `fingerprint`, and internal trust fields that must never reach an
 * unauthenticated browser.
 *
 * This test drives the unified handler (isUnifiedBackboneActive=true) and
 * asserts that the response contains NONE of the sensitive upstream fields,
 * even when the upstream mock injects them.
 *
 * Pre-fix: `return NextResponse.json({ ...upstream, verification_id, ... })`
 * spread the entire upstream blob → encrypted_credentials leaked.
 * Post-fix: explicit allowlist → only verification_id/public_token/expires_at
 * (+ optional metrics_snapshot/status).
 */
describe("NEW-C35-01 — unified path does not spread encrypted_credentials", () => {
  // Drive the unified path
  const isUnifiedMock = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    verificationCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("response body contains NO encrypted_credentials even when upstream injects them", async () => {
    vi.doMock("@/lib/feature-flags", () => ({
      isUnifiedBackboneActive: isUnifiedMock,
    }));

    // Mock process-key-client to return a response that includes sensitive fields
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: true,
        response: null,
        body: {
          verification_id: "33333333-3333-3333-3333-333333333333",
          status: "published",
          trust_tier: "api_verified",
          encrypted_credentials: "aes-gcm:AAAA...SENSITIVE_CIPHERTEXT",
          fingerprint: "sha256:abc123",
          metrics_snapshot: { twr: 0.12 },
        },
      }),
    }));

    // Mock admin client for public_token persist
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from(table: string) {
          if (table === "strategy_verifications") {
            return { update: () => ({ eq: async () => ({ error: null }) }) };
          }
          throw new Error(`unexpected: ${table}`);
        },
      }),
    }));

    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(200);

    const body = await res.json();
    // Contract: no credential/internal fields leaked
    expect(body).not.toHaveProperty("encrypted_credentials");
    expect(body).not.toHaveProperty("fingerprint");
    expect(body).not.toHaveProperty("trust_tier");
    // Contract: required landing-page fields are present
    expect(body).toHaveProperty("verification_id");
    expect(body).toHaveProperty("public_token");
    expect(body).toHaveProperty("expires_at");
  });
});
