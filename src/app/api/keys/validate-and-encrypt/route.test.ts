import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
// Phase 140 / SEAM-04: the REAL breaker error, taken from the dependency-free
// leaf. It must NEVER be picked up through `@/lib/analytics-client` — this file
// mocks that module wholesale (a full factory, no importActual), so the class
// read through it would be `undefined` and `err instanceof undefined` throws a
// TypeError from inside the route's own catch block (threat T-140-30). Nothing
// mocks the leaf, and this file never calls vi.resetModules(), so a static
// import here is the same class object the route narrows against.
import { CircuitOpenError } from "@/lib/seam-errors";

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
  // 140.4-13 / SEAMRIM-05 — `reason` is the THIRD outcome: absent is a genuine
  // throttle (429), "ratelimit_misconfigured" is OUR store being unreachable
  // and must answer 503.
  rateLimitResult: {
    success: true as boolean,
    retryAfter: 0,
    reason: undefined as "ratelimit_misconfigured" | undefined,
  },
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

// ⚠️ EXTENDED, NOT REPLACED (140.4-13 / SEAMRIM-05). See the note in
// `src/__tests__/csv-validate-route.test.ts`: the pure helpers come from
// `importActual` so this mock cannot drift from the real 503-vs-429 decision.
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    userActionLimiter: null,
    checkLimit: async () => rateLimitResult,
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

vi.mock("@/lib/analytics-client", () => {
  // Real-shape error classes so the route's `err instanceof AnalyticsUpstreamError`
  // narrowing resolves against the same constructor identity (F5b R8).
  class AnalyticsUpstreamError extends Error {
    readonly status: number;
    // 140.3-G4 / SEAMUX-03 — the stable machine code the seam envelope carried,
    // or null. Additive + optional so every 2-arg construction site keeps null,
    // exactly like the real class (analytics-client.ts:119). The route's
    // 4xx-forward arm reads it (`code: err.seamCode ?? "UNKNOWN"`).
    readonly seamCode: string | null;
    constructor(message: string, status: number, seamCode: string | null = null) {
      super(message);
      this.name = "AnalyticsUpstreamError";
      this.status = status;
      this.seamCode = seamCode;
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
    rateLimitResult.reason = undefined;
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

  // ── (1b) 140.4-13 / SEAMRIM-05 — our own limiter's outage → 503 ──────
  it("ratelimit_misconfigured → 503, not a 429 that reads as the caller's fault", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 60;
    rateLimitResult.reason = "ratelimit_misconfigured";

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(
      res.status,
      "A missing/unreachable Upstash store is OUR misconfiguration. Answering " +
        "429 tells the user to slow down and hides the outage from the canary.",
    ).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Retry-After")).toBe("60");
    // 140.3-G4 / SEAMUX-03: the misconfigured deny body carries the same code
    // keys/sync uses — SEAM_MISCONFIGURED — with the builder's default sentence
    // byte-kept. The exact-match oracle reddens if the code is dropped.
    expect(await res.json()).toEqual({
      error: "Rate limiter unavailable",
      code: "SEAM_MISCONFIGURED",
    });
    expect(mockValidateKey).not.toHaveBeenCalled();
    expect(mockEncryptKey).not.toHaveBeenCalled();

    rateLimitResult.reason = undefined;
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

  // ── (4d) Breaker open → 503 + Retry-After, no probe, no Sentry ──────
  // Phase 140 / SEAM-04 (SC-5c). Before this arm a breaker trip fell through
  // to the generic 500 "Key validation failed. Please try again." — which tells
  // the user their KEY is at fault when in fact no request ever left Vercel,
  // and invites an immediate retry against a service known to be down.
  it("returns 503 + Retry-After when the Railway breaker is open (SC-5c)", async () => {
    // 5, deliberately NOT the 30s breaker default (which is simultaneously
    // BREAKER_COOLDOWN_S and DEFAULT_RETRY_AFTER_S): a hardcoded "30" in the
    // route would pass a 30-second fixture but fails this one.
    mockValidateKey.mockRejectedValue(new CircuitOpenError(5));

    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.error).toBe(
      "The analytics service is temporarily unavailable. Please try again in a moment.",
    );
    // T-140-17: the copy names no infrastructure, and must not blame the key.
    expect(body.error).not.toMatch(/circuit|breaker|upstash|railway|http/i);
    expect(body.error).not.toMatch(/key validation failed/i);
    // A breaker trip is a shared infrastructure state, not a per-request
    // defect: capturing it would emit one Sentry event per request for the
    // whole cooldown window (mirrors the 4xx-forward / 504 no-Sentry stance).
    expect(captureSpy).not.toHaveBeenCalled();
    // Never encrypt a key we could not validate.
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  // ── HI-03: a SHORT per-request credential must not reach either sink ──
  it("HI-03: a short api_key and a 6-char passphrase are redacted from BOTH console.error and Sentry", async () => {
    // ⚠️ THE WIRING, NOT THE HELPER. The leaf's own test pins that a short
    // per-request secret is redacted; this pins that THIS route — the one whose
    // request body carries the raw exchange credentials — actually reaches that
    // behaviour at both sinks. Sentry is a third party, so the leaf is the last
    // control before the value leaves our infrastructure.
    //
    // Both values are hand-typed and both are BELOW the 12-char env floor.
    // Neither length is hypothetical: an MT5 `api_key` is the 8-digit account
    // login number, and an OKX passphrase is user-chosen — this route validates
    // only `passphrase.trim().length !== 0`. Driven here on the `okx` shape so
    // the case does not depend on the MT5_ENABLED server gate.
    const shortApiKey = "26547876";
    const shortPassphrase = "hunter";
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    mockValidateKey.mockRejectedValue(
      new Error(
        `upstream rejected api_key=${shortApiKey} passphrase=${shortPassphrase} — connect ECONNREFUSED 10.0.0.1:8002`,
      ),
    );

    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        exchange: "okx",
        api_key: shortApiKey,
        api_secret: "okx-api-secret-long-enough",
        passphrase: shortPassphrase,
      }),
    );
    expect(res.status).toBe(500);

    const logged = consoleErr.mock.calls
      .map((args) => args.map((a) => String(a)).join(" "))
      .join("\n");
    expect(logged).toContain("validation failed");
    expect(logged).not.toContain(shortApiKey);
    expect(logged).not.toContain(`passphrase=${shortPassphrase}`);
    // The preserve side on the same line: redacting must not eat the syscall
    // token, which is the most valuable thing an operator has here.
    expect(logged).toContain("ECONNREFUSED");

    // The Sentry sink takes the SAME leaf, but it is MOCKED in this file, so
    // this half asserts the ROUTE's obligation only: that it HANDS both short
    // values to the sink as `secrets`. Asserting the spy's recorded args do not
    // CONTAIN them would be backwards — the route is supposed to pass them, so
    // the sink can redact them.
    //
    // The other half ("the sink actually redacts a SHORT per-request secret")
    // is owned by sentry-capture.test.ts, where the real leaf runs.
    expect(captureSpy).toHaveBeenCalled();
    const sentrySecrets = captureSpy.mock.calls[0][1].secrets;
    expect(sentrySecrets).toContain(shortApiKey);
    expect(sentrySecrets).toContain(shortPassphrase);

    consoleErr.mockRestore();
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
    expect(mockValidateKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp", { userId: TEST_USER.id });
    expect(mockEncryptKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp", { userId: TEST_USER.id });
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
    rateLimitResult.reason = undefined;
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
    expect(mockValidateKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: TEST_USER.id });
    expect(mockEncryptKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: TEST_USER.id });
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
    expect(mockValidateKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: TEST_USER.id });
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
      expect(mockValidateKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: TEST_USER.id });
      expect(mockEncryptKey).toHaveBeenCalledWith("sfox", SFOX_TOKEN, "", undefined, { userId: TEST_USER.id });
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
    rateLimitResult.reason = undefined;
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
    expect(mockValidateKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp", { userId: TEST_USER.id });
  });
});

/**
 * Phase 135 (MT5SRC-03) — MT5 is the MIRROR-IMAGE of the sfox carve-out.
 *
 * (a) Server gate: with MT5_ENABLED unset (the default), an mt5 connect FAILS
 *     CLOSED with an honest "not yet available" 400 and NO live probe — the
 *     dark-until-go-live (Phase 139) posture the worker's mt5_enabled_server()
 *     gate enforces behind it.
 * (b) Three-credential defense: where sfox RELAXES api_secret, mt5 REQUIRES all
 *     three non-blank slots (login/api_key, investor password/api_secret, broker
 *     server/passphrase). A missing/blank slot is a 400 BEFORE any worker call.
 * (c) Gate-on happy path: all three slots forward to validateKey then encryptKey.
 */
const MT5_BODY = {
  exchange: "mt5",
  api_key: "5001234",
  api_secret: "investor-password-123",
  passphrase: "MetaQuotes-Demo",
};

describe("POST /api/keys/validate-and-encrypt — mt5 server gate (MT5_ENABLED off)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    rateLimitResult.reason = undefined;
    delete process.env.MT5_ENABLED;
    mockValidateKey.mockResolvedValue({ valid: true, read_only: true });
    mockEncryptKey.mockResolvedValue({ api_key_encrypted: "ct-blob" });
  });

  it.each(["mt5", "MT5", "Mt5"])(
    "fails closed for %s with no live probe when MT5_ENABLED is unset",
    async (exchange) => {
      const { POST } = await import("./route");
      const res = await POST(makeReq({ ...MT5_BODY, exchange }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("MT5 integration is not yet available.");
      // No live probe, no encryption of a key we refuse to admit while dark.
      expect(mockValidateKey).not.toHaveBeenCalled();
      expect(mockEncryptKey).not.toHaveBeenCalled();
    },
  );

  it.each(["1", "TRUE", "on", ""])(
    "stays fail-closed for a non-exact MT5_ENABLED=%s (strict === 'true')",
    async (flag) => {
      process.env.MT5_ENABLED = flag;
      const { POST } = await import("./route");
      const res = await POST(makeReq(MT5_BODY));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("MT5 integration is not yet available.");
      expect(mockValidateKey).not.toHaveBeenCalled();
      delete process.env.MT5_ENABLED;
    },
  );

  it("does NOT gate ccxt exchanges — okx runs normally with MT5_ENABLED unset", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    expect(mockValidateKey).toHaveBeenCalledWith("okx", "okx-api-key", "okx-api-secret", "pp", { userId: TEST_USER.id });
  });
});

describe("POST /api/keys/validate-and-encrypt — mt5 three-credential defense (MT5_ENABLED on)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    rateLimitResult.reason = undefined;
    process.env.MT5_ENABLED = "true";
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
    delete process.env.MT5_ENABLED;
  });

  it.each([
    ["api_key missing", { api_secret: "investor-password-123", passphrase: "MetaQuotes-Demo" }],
    ["api_secret missing", { api_key: "5001234", passphrase: "MetaQuotes-Demo" }],
    ["passphrase (broker server) missing", { api_key: "5001234", api_secret: "investor-password-123" }],
    ["passphrase blank/whitespace", { api_key: "5001234", api_secret: "investor-password-123", passphrase: "   " }],
    ["api_secret blank/whitespace", { api_key: "5001234", api_secret: "  ", passphrase: "MetaQuotes-Demo" }],
  ])(
    "rejects mt5 with %s BEFORE any worker call (three-cred defense, mirror of sfox relaxation)",
    async (_label, partial) => {
      const { POST } = await import("./route");
      const res = await POST(makeReq({ exchange: "mt5", ...partial }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Missing required fields");
      // The mirror-image of sfox: mt5 flows the api_secret-REQUIRED path AND
      // additionally requires the broker server — no sfox-style relaxation leaks.
      expect(mockValidateKey).not.toHaveBeenCalled();
      expect(mockEncryptKey).not.toHaveBeenCalled();
    },
  );

  it("forwards all THREE mt5 slots to validateKey then encryptKey on the happy path", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(MT5_BODY));

    expect(res.status).toBe(200);
    // Canonical lowercase 'mt5' + login/api_key, investor pw/api_secret, broker
    // server/passphrase — the exact slot mapping the worker's is_mt5 branch reads.
    expect(mockValidateKey).toHaveBeenCalledWith(
      "mt5",
      "5001234",
      "investor-password-123",
      "MetaQuotes-Demo",
      { userId: TEST_USER.id },
    );
    expect(mockEncryptKey).toHaveBeenCalledWith(
      "mt5",
      "5001234",
      "investor-password-123",
      "MetaQuotes-Demo",
      { userId: TEST_USER.id },
    );
  });

  it("normalizes mixed-case MT5 to canonical lowercase 'mt5' downstream", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ ...MT5_BODY, exchange: "MT5" }));

    expect(res.status).toBe(200);
    expect(mockValidateKey).toHaveBeenCalledWith(
      "mt5",
      "5001234",
      "investor-password-123",
      "MetaQuotes-Demo",
      { userId: TEST_USER.id },
    );
  });
});

/**
 * B-13 (Phase 140.2 / SEAMCORE-08, ROADMAP SC6 clause c) — the dormant
 * handler's budget-key pin.
 *
 * `_unifiedValidateAndEncryptHandler` is module-private and has ZERO callers:
 * the exported POST always takes the legacy branch, because `/process-key` has
 * no encrypt step yet and delegating would write all-NULL ciphertext to
 * api_keys. So there is no way to DRIVE this binding, and every behavioural pin
 * in the phase's thirteen is unavailable here. Reading the source is the only
 * honest oracle left.
 *
 * Pinning it anyway is the whole point of routing a dormant call through the
 * core in the first place: whoever revives this handler inherits a budget and
 * the breaker automatically. If the key silently drifts while the handler
 * sleeps, they inherit the WRONG budget instead — 60s of a Vercel concurrency
 * slot versus 15s — and nothing would have said so.
 *
 * ⚠️ This is a DISK read, deliberately, not an assertion through this file's
 * mocks. Every mock above replaces `@/lib/analytics-client`; a pin that read
 * the binding through a wholesale mock would prove only that the mock returns
 * what the mock was told to return.
 *
 * The pattern requires the call syntax and both literals adjacent, so an
 * explanatory comment mentioning either string cannot satisfy it (this repo has
 * hit prose-defeats-the-guard three times).
 */
describe("[SEAMCORE-08 / B-13] the dormant unified handler's budget key", () => {
  it("binds process-key-unified-dormant to /process-key at the core call", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/keys/validate-and-encrypt/route.ts"),
      "utf8",
    );

    expect(
      /resilientFetch\(\s*"process-key-unified-dormant"\s*,\s*"\/process-key"/.test(
        src,
      ),
      "The dormant unified handler no longer binds the " +
        '"process-key-unified-dormant" budget to "/process-key". This handler ' +
        "cannot be driven by a test (it is private and has no callers), so this " +
        "source pin is the ONLY thing standing between a silent key swap and a " +
        "revived handler running on someone else's deadline. It is also one of " +
        "the thirteen bindings the roster in " +
        "src/lib/resilient-fetch.wiring.test.ts keeps closed — update both.",
    ).toBe(true);
  });
});

/**
 * Phase 140.3-G4 / SEAMUX-03 — a machine `code` on every error arm THIS route
 * itself emits, so a client discriminates the fault on a stable token instead
 * of sniffing prose. At HEAD this route emitted ZERO coded arms
 * (140.3-VERIFICATION §3.1: 0/10). Mirrors 140.3-10's pass on keys/sync and the
 * sibling create-with-key's deny-body precedent (KEY_RATE_LIMIT + SEAM_MISCONFIGURED).
 *
 * ⚠️ This route's request body carries RAW key material (SEAMCORE-06); these
 * assertions read RESPONSE bodies only.
 *
 * ORACLE INDEPENDENCE: every expected code is a hand-typed literal.
 */
describe("[140.3-G4 / SEAMUX-03] POST /api/keys/validate-and-encrypt — a machine code on every arm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    rateLimitResult.reason = undefined;
    mockValidateKey.mockResolvedValue({ valid: true, read_only: true });
    mockEncryptKey.mockResolvedValue({ api_key_encrypted: "ct-blob" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── the input 400 arm ──
  it("400 missing required fields → code KEY_INVALID_FORMAT", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq({ exchange: "okx", api_key: "k" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_INVALID_FORMAT");
  });

  // ── the deny arm: two bodies, two tokens ──
  it("429 throttle carries the EXACT { error, code: KEY_RATE_LIMIT } pair", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 12;
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(429);
    // KEY_RATE_LIMIT (not RATE_LIMITED): this is the key-connect family and its
    // two already-coded siblings both chose KEY_RATE_LIMIT.
    expect(await res.json()).toEqual({
      error: "Too many requests",
      code: "KEY_RATE_LIMIT",
    });
  });

  // (the misconfigured deny body → SEAM_MISCONFIGURED is pinned by the
  //  exact-match assertion in the SEAMRIM-05 case above.)

  // ── the read-only rejection ──
  it("400 could-not-verify-read-only → code KEY_NOT_READ_ONLY", async () => {
    mockValidateKey.mockResolvedValue({ valid: true, read_only: false });
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_NOT_READ_ONLY");
  });

  // ── the breaker 503 ──
  it("503 breaker open → code CIRCUIT_OPEN (the wire token process-key-client emits)", async () => {
    mockValidateKey.mockRejectedValue(new CircuitOpenError(5));
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.code).toBe("CIRCUIT_OPEN");
    // The breaker copy and Retry-After stay byte-unchanged.
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  // ── the 4xx forward: preserve the upstream's own code ──
  it("4xx forward PRESERVES the upstream's own seamCode when it carried one", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError("Invalid API credentials", 400, "KEY_AUTH_FAILED"),
    );
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    // Never overwrite an upstream-carried code.
    expect(body.code).toBe("KEY_AUTH_FAILED");
    expect(body.error).toBe("Invalid API credentials");
  });

  it("4xx forward falls back to UNKNOWN only when the upstream carried NO code", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError("Key has IP restrictions", 403),
    );
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("UNKNOWN");
  });

  // ── the timeout 504 ──
  it("504 timeout → code UPSTREAM_TIMEOUT (OUR analytics hop, not the exchange)", async () => {
    const { AnalyticsTimeoutError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsTimeoutError("/api/validate-key", 30000),
    );
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(504);
    expect((await res.json()).code).toBe("UPSTREAM_TIMEOUT");
  });

  // ── the terminal 500 ──
  it("500 terminal unclassified → code UNKNOWN", async () => {
    mockValidateKey.mockRejectedValue(new Error("crypto: internal failure"));
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Key validation failed. Please try again.");
    expect(body.code).toBe("UNKNOWN");
  });
});
