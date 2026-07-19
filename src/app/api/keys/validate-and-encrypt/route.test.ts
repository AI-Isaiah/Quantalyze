import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * H-0281 — real route coverage for POST /api/keys/validate-and-encrypt.
 *
 * The previous contents of this file were TAUTOLOGICAL: every test asserted
 * on hardcoded local arrays/strings (PUBLIC_ROUTES, inline proxy logic) and
 * never imported the route handler. A refactor that broke the route could
 * not fail those tests because they had no dependency on `./route`.
 *
 * This rewrite drives the actual handler and pins its hot paths:
 *   (1) 429 + Retry-After when checkLimit fails
 *   (2) 400 when exchange / api_key / api_secret missing
 *   (3) 400 with an honest could-not-verify-read-only backstop (NOT a scope
 *       claim) when validation.read_only=false with no curated cause — after
 *       DOGFOOD-3, genuine scope rejections + probe failures arrive as curated
 *       4xx details via the F5b forward, so this unknown-cause branch must not
 *       assert trade/withdraw scopes it never observed
 *   (4) 400 with the propagated error.message when validateKey throws
 *   (5) happy path: {valid:true, read_only:true, ...encryptKey payload}
 *
 * Mocking mirrors keys/sync/route.test.ts: the route is wrapped by the REAL
 * withAuth, so `@/lib/supabase/server` is stubbed to return an authenticated
 * user (the approval gate is globally no-op'd in src/test-setup.ts).
 */

const VALID_ORIGIN = { origin: "http://localhost:3000" };

const {
  TEST_USER,
  mockValidateKey,
  mockEncryptKey,
  rateLimitResult,
} = vi.hoisted(() => ({
  TEST_USER: { id: "00000000-0000-0000-0000-aaaaaaaaaaaa" },
  mockValidateKey: vi.fn(),
  mockEncryptKey: vi.fn(),
  rateLimitResult: { success: true as boolean, retryAfter: 0 },
}));

// audit + supabase server modules import "server-only" which throws under
// vitest+jsdom.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: TEST_USER }, error: null }),
    },
  }),
}));

vi.mock("@/lib/ratelimit", () => ({
  userActionLimiter: null,
  checkLimit: async () => rateLimitResult,
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
    validateKey: mockValidateKey,
    encryptKey: mockEncryptKey,
    AnalyticsUpstreamError,
    AnalyticsTimeoutError,
  };
});

// F5b (R8): spy on captureToSentry so the 5xx-redaction test can pin that the
// internal detail still reaches Sentry now that err.message is no longer echoed.
const captureSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureSpy }));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

function makeReq(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/keys/validate-and-encrypt", {
    method: "POST",
    headers: { "content-type": "application/json", ...VALID_ORIGIN },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  exchange: "okx",
  api_key: "okx-api-key",
  api_secret: "okx-api-secret",
  passphrase: "pp",
};

describe("POST /api/keys/validate-and-encrypt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    mockValidateKey.mockResolvedValue({ valid: true, read_only: true });
    mockEncryptKey.mockResolvedValue({
      api_key_encrypted: "ct-blob",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: "dek-ct",
      nonce: "nonce-b64",
      kek_version: 3,
    });
  });

  // ── (1) Rate limit → 429 + Retry-After ──────────────────────────────
  it("returns 429 with Retry-After when checkLimit fails", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 17;

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    const body = await res.json();
    expect(body.error).toBe("Too many requests");
    // Short-circuited before touching the validation/encryption pipeline.
    expect(mockValidateKey).not.toHaveBeenCalled();
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (2) Missing required fields → 400 ───────────────────────────────
  it("returns 400 when exchange is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ api_key: "k12345678", api_secret: "s12345678" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing required fields");
    expect(mockValidateKey).not.toHaveBeenCalled();
  });

  it("returns 400 when api_key is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "okx", api_secret: "s12345678" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
  });

  it("returns 400 when api_secret is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "okx", api_key: "k12345678" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
  });

  // ── (3) Non-read-only key, unknown cause → 400 honest backstop ─────
  it("returns 400 with an honest could-not-verify backstop (no scope claim) when validation.read_only is false", async () => {
    mockValidateKey.mockResolvedValue({ valid: true, read_only: false });

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      "This key could not be verified as read-only. Only read-only keys are accepted.",
    );
    // DOGFOOD-3 regression: a bare read_only:false 200 carries no scope
    // evidence (it also fires on a Python fail-closed probe), so the backstop
    // must NEVER assert trade/withdraw scopes it never observed.
    expect(body.error).not.toMatch(/trading or withdrawal permissions/);
    // A non-read-only key must NEVER be encrypted to disk.
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (4) validateKey throws a generic/5xx error → 500 STATIC, no leak ──
  it("returns 500 with a STATIC message (not the raw error) when validateKey throws a non-upstream error", async () => {
    // F5b (R8): a generic Error (crypto failure, contract drift, unreachable
    // service) must NOT have its message echoed — that leaked Python
    // tracebacks / crypto internals to the allocator. Redact + capture.
    mockValidateKey.mockRejectedValue(
      new Error("crypto: internal nonce derivation failed at kek.ts:42"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Key validation failed. Please try again.");
    expect(body.error).not.toContain("crypto");
    expect(body.error).not.toContain("kek.ts");
    expect(captureSpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: { route: "api/keys/validate-and-encrypt" },
      }),
    );
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (4b) validateKey throws a curated 4xx → forwarded with its status ──
  it("forwards a curated 4xx AnalyticsUpstreamError so actionable key errors still reach the user", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError("Invalid API credentials for this exchange", 400),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(400);
    const body = await res.json();
    // The curated 4xx detail is user-actionable — it MUST still reach the
    // client so the user can fix their key (not redacted like a 5xx).
    expect(body.error).toBe("Invalid API credentials for this exchange");
    expect(captureSpy).not.toHaveBeenCalled();
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (4c) validateKey times out → 504 STATIC, no Sentry ─────────────
  it("returns 504 with static copy when validateKey times out (timeout is upstream-expected, not a 5xx alert)", async () => {
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsTimeoutError("/api/validate-key", 30000),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(504);
    const body = await res.json();
    expect(body.error).toBe("Key validation timed out. Please try again.");
    // A timeout is an expected upstream condition — NOT captured to Sentry
    // (mirrors the 4xx-forward no-Sentry anti-assertion above).
    expect(captureSpy).not.toHaveBeenCalled();
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── (5) Happy path → 200 with encryptKey payload + valid/read_only ──
  it("returns the encryptKey payload spread with valid:true, read_only:true on success", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    // Block D / P1947: the success body carries the caller's ENCRYPTED
    // credential ciphertext (dek_encrypted/nonce/api_*_encrypted). It must
    // never be absorbed by a shared cache and served to another tenant.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({
      api_key_encrypted: "ct-blob",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: "dek-ct",
      nonce: "nonce-b64",
      kek_version: 3,
      valid: true,
      read_only: true,
    });

    // validate-then-encrypt ordering: validation runs before encryption
    // (TOCTOU-safe back-to-back) and both received the same credentials.
    expect(mockValidateKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp");
    expect(mockEncryptKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp");
  });
});

/**
 * SFOX-03 / 119-CONTEXT Q1 (LOCKED) — the SECURITY-SENSITIVE api_secret carve-out.
 *
 * sFOX authenticates with a SINGLE Bearer token (no api_secret — 118-RESEARCH
 * confirmed). For `exchange === "sfox"` ONLY, the presence gate at :23 must admit a
 * missing/empty api_secret, normalize it to "", and route it through the SAME
 * validateKey/encryptKey chokepoint (trimCredential("") === "") — never a parallel
 * path. Every ccxt exchange (binance/okx/bybit/deribit) keeps the byte-identical
 * presence rejection, proving the relaxation weakens nothing (T-119-08/09/11).
 */
describe("POST /api/keys/validate-and-encrypt — sfox api_secret carve-out (SFOX-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    // F2 (Phase 122): the carve-out only runs when the server go-live flag is
    // ON. These tests exercise the ENABLED path, so pin SFOX_ENABLED=true; the
    // disabled default is covered by the dedicated fail-closed block below.
    process.env.SFOX_ENABLED = "true";
    mockValidateKey.mockResolvedValue({ valid: true, read_only: true });
    mockEncryptKey.mockResolvedValue({
      api_key_encrypted: "ct-blob",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: "dek-ct",
      nonce: "nonce-b64",
      kek_version: 3,
    });
  });

  afterEach(() => {
    delete process.env.SFOX_ENABLED;
  });

  const SFOX_TOKEN = "sfox-bearer-token-value";

  it("accepts sfox with NO api_secret and calls validateKey/encryptKey with api_secret '' (shared chokepoint)", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "sfox", api_key: SFOX_TOKEN }));

    expect(res.status).toBe(200);
    // The absent secret is normalized to "" and flows through the SAME funnel the
    // ccxt path uses — NOT a parallel branch. trimCredential("") === "".
    expect(mockValidateKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
    expect(mockEncryptKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
  ])("normalizes sfox api_secret=%s identically to '' through validateKey", async (_label, secret) => {
    const body: Record<string, unknown> = { exchange: "sfox", api_key: SFOX_TOKEN };
    if (secret !== undefined) body.api_secret = secret;

    const { POST } = await import("./route");
    const res = await POST(makeReq(body));

    expect(res.status).toBe(200);
    expect(mockValidateKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
  });

  // ── WR-01: mixed-case sfox is handled IDENTICALLY to the sibling routes ──
  it.each(["sFOX", "SFOX", "Sfox"])(
    "accepts mixed-case %s (case-insensitive carve-out) and normalizes the exchange to canonical 'sfox' downstream",
    async (exchange) => {
      const { POST } = await import("./route");
      const res = await POST(makeReq({ exchange, api_key: SFOX_TOKEN }));

      expect(res.status).toBe(200);
      // WR-01: the case-sensitive `exchange === "sfox"` used to 400 this input
      // ("Missing required fields") while the create-with-key / add-key siblings
      // accepted it. The empty secret is admitted AND the value forwarded to the
      // worker + stored in the DB is the canonical lowercase 'sfox' (the DB CHECK
      // admits only lowercase 'sfox'), never the raw mixed-case string.
      expect(mockValidateKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
      expect(mockEncryptKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined);
    },
  );

  it("rejects sfox with NO api_key — the carve-out relaxes ONLY api_secret, never api_key", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "sfox" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
    expect(mockValidateKey).not.toHaveBeenCalled();
  });

  it("surfaces a fail-closed error when the worker rejects sfox auth (no false-verified)", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError("Authentication failed. Check your API key and secret.", 400),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "sfox", api_key: SFOX_TOKEN }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Authentication failed. Check your API key and secret.",
    );
    // Never encrypted a key the exchange refused to authenticate.
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── ccxt exchanges are UNCHANGED — the relaxation is sfox-only ──────────
  it.each(["binance", "deribit"])(
    "STILL rejects %s with NO api_secret — byte-identical 400 'Missing required fields'",
    async (exchange) => {
      const { POST } = await import("./route");
      const res = await POST(makeReq({ exchange, api_key: "ccxt-key-123456" }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Missing required fields");
      expect(mockValidateKey).not.toHaveBeenCalled();
    },
  );

  it("STILL rejects binance with an EMPTY api_secret (carve-out is sfox-only)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ exchange: "binance", api_key: "ccxt-key-123456", api_secret: "" }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
    expect(mockValidateKey).not.toHaveBeenCalled();
  });
});

/**
 * F2 (Phase 122 — STRUCTURAL server gate): sFOX is founder-gated until go-live.
 * With SFOX_ENABLED unset (the default), a sfox connect must FAIL CLOSED with an
 * honest "not yet available" 400 — never a crash, never a false KEY_AUTH_FAILED,
 * and NEVER a live probe (validateKey/encryptKey are not called). ccxt exchanges
 * are entirely unaffected by the server flag.
 */
describe("POST /api/keys/validate-and-encrypt — sfox server gate (F2, SFOX_ENABLED off)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    delete process.env.SFOX_ENABLED;
    mockValidateKey.mockResolvedValue({ valid: true, read_only: true });
    mockEncryptKey.mockResolvedValue({ api_key_encrypted: "ct-blob" });
  });

  it.each(["sfox", "sFOX", "SFOX"])(
    "fails closed for %s with no live probe when SFOX_ENABLED is unset",
    async (exchange) => {
      const { POST } = await import("./route");
      const res = await POST(
        makeReq({ exchange, api_key: "sfox-bearer-token-value" }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("sFOX integration is not yet available.");
      // No live probe, no encryption of a key we refuse to admit.
      expect(mockValidateKey).not.toHaveBeenCalled();
      expect(mockEncryptKey).not.toHaveBeenCalled();
    },
  );

  it.each(["1", "TRUE", "on", ""])(
    "stays fail-closed for a non-exact SFOX_ENABLED=%s (strict === 'true')",
    async (flag) => {
      process.env.SFOX_ENABLED = flag;
      const { POST } = await import("./route");
      const res = await POST(
        makeReq({ exchange: "sfox", api_key: "sfox-bearer-token-value" }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("sFOX integration is not yet available.");
      expect(mockValidateKey).not.toHaveBeenCalled();
      delete process.env.SFOX_ENABLED;
    },
  );

  it("does NOT gate ccxt exchanges — okx runs normally with SFOX_ENABLED unset", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    expect(mockValidateKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp");
  });
});
