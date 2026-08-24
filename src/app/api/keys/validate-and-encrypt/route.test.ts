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
// 160 review F1 — the encrypt contract, read as DATA (`.shape`) so the persist
// tracer can assert the INSERT writes every field it declares rather than the
// two this file happened to hand-pick. Not mocked anywhere in this file, so
// this is the same object the route projects its `encryptedColumns` from.
import { EncryptKeyResponseSchema } from "@/lib/analytics-schemas";

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
  PERSIST_STATE,
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
  /**
   * 160-02 / RANK-03 — STATE capture for the persist arm's admin-client write,
   * mirroring the finalize-wizard test harness idiom.
   *
   * `inserts` is the whole point: the route's INSERT payload is recorded here
   * so a test can assert what the SERVER decided to write (both venue columns,
   * the tenant id) rather than what the caller asked for. An EMPTY `inserts`
   * array is itself an oracle — it is how the legacy-arm tests prove that a
   * body without the strict boolean discriminator mints no row at all.
   */
  PERSIST_STATE: {
    inserts: [] as Record<string, unknown>[],
    /** The `{ data, error }` the `.single()` terminal resolves to. */
    insertResult: null as { data: unknown; error: unknown } | null,
    /** When set, `createAdminClient()` THROWS this — the missing-service-key arm. */
    adminFactoryError: null as Error | null,
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

/**
 * 160-02 / RANK-03 — the service-role writer the persist arm uses.
 *
 * The chain is modelled exactly as the route calls it —
 * `.from(table).insert(payload).select(cols).single()` — and the payload is
 * pushed into PERSIST_STATE.inserts BEFORE the terminal resolves, so a test can
 * read what was written even on the arms where the insert then fails.
 *
 * `from` records the table too: the assertion "the row went into api_keys" is
 * worth nothing if the mock would have accepted any table name.
 */
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (PERSIST_STATE.adminFactoryError) throw PERSIST_STATE.adminFactoryError;
    return {
      from: (table: string) => ({
        insert: (payload: Record<string, unknown>) => {
          PERSIST_STATE.inserts.push({ ...payload, __table: table });
          return {
            select: (_cols?: string) => ({
              single: async () =>
                PERSIST_STATE.insertResult ?? {
                  data: { id: "persisted-key-id" },
                  error: null,
                },
            }),
          };
        },
      }),
    };
  },
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
    // 161-06 / WIZERR-05 — the 4th and 5th, mirroring the real class
    // (`analytics-client.ts`) parameter-for-parameter. `dependency` was added
    // there by 140.3-11 and this double never picked it up; `retryAfterSeconds`
    // is 161-06's. Both are additive and optional, so every pre-existing
    // construction in this file keeps passing fewer args and keeps defaulting.
    // ⚠️ ORDER IS THE POINT, not just presence: with `dependency` missing, a
    // 4th positional argument would be the WAIT here and the DEPENDENCY NAME in
    // production. `analytics-upstream-error.parity.invariant.test.ts` is what
    // makes that a failure instead of a convention — it is why this block can
    // no longer drift in silence.
    readonly dependency: string | null;
    readonly retryAfterSeconds: number | null;
    constructor(
      message: string,
      status: number,
      seamCode: string | null = null,
      dependency: string | null = null,
      retryAfterSeconds: number | null = null,
    ) {
      super(message);
      this.name = "AnalyticsUpstreamError";
      this.status = status;
      this.seamCode = seamCode;
      this.dependency = dependency;
      this.retryAfterSeconds = retryAfterSeconds;
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

/**
 * 160-05 / RANK-03 — `persist: true` is part of the VALID body now, not an
 * opt-in. The legacy arm is retired: a body without the discriminator is
 * refused with `STALE_CLIENT`, so a fixture that omitted it would measure that
 * refusal instead of the arm it names — on every case that REACHES the
 * handler, i.e. past the sfox/mt5 venue gates and the presence check, which
 * all sit ABOVE the discriminator gate and short-circuit before it.
 *
 * ⭐ WHY THE GATE CASES BELOW CARRY IT TOO (160-05 review F1). A gate test's
 * load-bearing oracle is `expect(mockValidateKey).not.toHaveBeenCalled()` — "no
 * live credential probe was spent". That oracle is only falsifiable when the
 * gate under test is the LAST thing between the request and the probe. Send a
 * discriminator-less body and the `STALE_CLIENT` gate catches it further down
 * regardless, so the pin passes whether or not the gate under test still
 * exists. MEASURED: with the sfox gate deleted from route.ts, the
 * discriminator-less cases failed only on `expected 409 to be 400` and
 * `validateKey` was still never called. With `persist: true` they fail on
 * `expected 200 to be 400` with `validateKey` CALLED — the gate's absence is
 * what reddens them.
 *
 * The retired-arm suite builds its own discriminator-less body.
 */
const VALID_BODY = {
  exchange: "okx",
  api_key: "okx-api-key",
  api_secret: "okx-api-secret",
  passphrase: "pp",
  persist: true,
};

/** VALID_BODY as a pre-160-02 client would have sent it: no discriminator. */
const { persist: _omitPersist, ...LEGACY_BODY } = VALID_BODY;

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
    // `persist: true` — see VALID_BODY. Without it the STALE_CLIENT gate would
    // refuse this body further down and the not-called pin below would hold
    // even with the presence check deleted.
    const res = await POST(
      makeReq({ api_key: "k12345678", api_secret: "s12345678", persist: true }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing required fields");
    expect(mockValidateKey).not.toHaveBeenCalled();
  });

  it("returns 400 when api_key is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ exchange: "okx", api_secret: "s12345678", persist: true }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing required fields");
  });

  it("returns 400 when api_secret is missing", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ exchange: "okx", api_key: "k12345678", persist: true }),
    );
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
        persist: true,
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

  // ── (5) Happy path → 200 with the persist envelope + valid/read_only ──
  it("returns the persisted row id with valid:true, read_only:true on success — and NO ciphertext", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(200);
    // Block D / P1947, restated for 160-05: the ciphertext this header was
    // minted for no longer leaves the server, but the header still earns its
    // place — the body names a tenant-scoped row id, and the REQUEST that
    // produced it carried raw exchange credentials. A shared cache must not
    // hold either end of that exchange.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({
      api_key_id: "persisted-key-id",
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
    const res = await POST(makeReq({ exchange: "sfox", api_key: SFOX_TOKEN, persist: true }));

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
    const body: Record<string, unknown> = { exchange: "sfox", api_key: SFOX_TOKEN, persist: true };
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
      const res = await POST(makeReq({ exchange, api_key: SFOX_TOKEN, persist: true }));

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
    const res = await POST(makeReq({ exchange: "sfox", persist: true }));

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
    const res = await POST(makeReq({ exchange: "sfox", api_key: SFOX_TOKEN, persist: true }));

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
      // `persist: true` — see VALID_BODY. It is what makes the not-called pin
      // below bite: with it, the presence check is the ONLY thing standing
      // between this body and a live credential probe.
      const res = await POST(
        makeReq({ exchange, api_key: "ccxt-api-key", persist: true }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Missing required fields");
      expect(mockValidateKey).not.toHaveBeenCalled();
    },
  );

  it("STILL rejects binance with an EMPTY api_secret (carve-out is sfox-only)", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        exchange: "binance",
        api_key: "ccxt-api-key",
        api_secret: "",
        persist: true,
      }),
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
      // `persist: true` — see VALID_BODY (review F1). MEASURED: without it, a
      // deleted sfox gate left this body refused by the STALE_CLIENT gate
      // (`expected 409 to be 400`) with `validateKey` still never called, so
      // the two not-called pins below held regardless of the gate's existence.
      // With it, the sfox gate is the LAST thing before the live probe.
      const res = await POST(
        makeReq({ exchange, api_key: "sfox-bearer-token-value", persist: true }),
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
        makeReq({
          exchange: "sfox",
          api_key: "sfox-bearer-token-value",
          persist: true,
        }),
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
  // 160-05 — see VALID_BODY: for every case that REACHES the handler (past the
  // mt5 venue gate and the presence check, both of which sit above the
  // discriminator gate), a body without `persist: true` would measure the
  // STALE_CLIENT refusal instead of the arm it names — and, on the gate cases,
  // would neuter their `not.toHaveBeenCalled()` pins.
  persist: true,
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
      // `persist: true` — see MT5_BODY / VALID_BODY (review F1). The
      // three-credential gate must be the LAST thing before the live probe, or
      // the two not-called pins below pass on the STALE_CLIENT refusal instead.
      const res = await POST(makeReq({ exchange: "mt5", ...partial, persist: true }));

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

  // ─────────────────────────────────────────────────────────────────────────
  // 161-08 / WIZERR-06 — the terminal arm forwards the CODE and still refuses
  // the MESSAGE.
  //
  // ⚠️ ORACLE INDEPENDENCE. The static sentence is HAND-TRANSCRIBED below,
  // never imported from the route.
  //
  // ⭐ THIS IS THE CREDENTIAL-BEARING ROUTE. Case (a) additionally re-pins that
  // the edited arm is still wrapped by the per-request secret list at the
  // Sentry sink — the widening moved `code` and nothing else, and the raw
  // `api_key` / `api_secret` / `passphrase` this request body carries must
  // still be handed to the sink so it can redact them.
  // ─────────────────────────────────────────────────────────────────────────

  /** Transcribed by hand from the route's terminal arm. Do NOT import it. */
  const VALIDATE_TERMINAL_SENTENCE = "Key validation failed. Please try again.";

  /**
   * Shaped like what F5b keeps off the wire: a crypto internal, a Python
   * source location and a service base URL.
   *
   * ⚠️ Every token here is deliberately DISJOINT from the static sentence and
   * from the forwarded code. "failed" and "unavailable" were both rejected as
   * corpus words for exactly that reason — a token the honest body legitimately
   * contains would make case (d) fail against a correct tree, which is the
   * mirror-image error of a test that cannot fail.
   */
  const LEAKY_5XX_MESSAGE =
    "RuntimeError: KEK derivation aborted inside crypto_kek.py:77 — upstream base http://analytics.invalid:8000";

  it("WIZERR-06 (a) — a 5xx seam error carrying a code forwards THAT code, sentence unchanged, secrets still scrubbed", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    // `encrypt_key`'s first statement is `get_kek()`; its RuntimeError is a
    // real 500 with `retryable=False`.
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError("KEK unavailable", 500, "KEK_UNAVAILABLE"),
    );
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("KEK_UNAVAILABLE");
    expect(body.error).toBe(VALIDATE_TERMINAL_SENTENCE);

    // The per-request secret list still reaches the Sentry sink from THIS arm.
    // Same obligation, same shape, as the ECONNREFUSED case above: the route
    // hands the values over so the sink can redact them.
    expect(captureSpy).toHaveBeenCalled();
    const sentrySecrets = captureSpy.mock.calls[0][1].secrets;
    expect(sentrySecrets).toContain(VALID_BODY.api_key);
    expect(sentrySecrets).toContain(VALID_BODY.api_secret);
    expect(sentrySecrets).toContain(VALID_BODY.passphrase);
  });

  it("WIZERR-06 (b) — a 5xx seam error with a NULL code still answers UNKNOWN, sentence unchanged", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError("upstream traceback", 502),
    );
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN");
    expect(body.error).toBe(VALIDATE_TERMINAL_SENTENCE);
  });

  it("WIZERR-06 (c) — a NON-SEAM throwable answers UNKNOWN, sentence unchanged", async () => {
    mockValidateKey.mockRejectedValue(new Error("ECONNREFUSED"));
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN");
    expect(body.error).toBe(VALIDATE_TERMINAL_SENTENCE);
  });

  it("WIZERR-06 (d) — NEGATIVE CONTROL: no substring of the thrown message reaches the body", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError(LEAKY_5XX_MESSAGE, 500, "KEK_UNAVAILABLE"),
    );
    const { POST } = await import("./route");
    const res = await POST(makeReq(VALID_BODY));
    const serialized = JSON.stringify(await res.json());

    // ⚠️ VACUITY GUARD, FIRST — `"anything".includes("")` is `true`.
    expect(LEAKY_5XX_MESSAGE.trim().length).toBeGreaterThan(40);
    const tokens = LEAKY_5XX_MESSAGE.split(/\s+/).filter((t) => t.length >= 4);
    expect(
      tokens.length,
      "the leak corpus produced too few usable tokens to be a real control",
    ).toBeGreaterThan(5);

    for (const token of tokens) {
      expect(
        serialized,
        `the 5xx body leaked "${token}" out of err.message`,
      ).not.toContain(token);
    }
    expect(serialized).not.toContain(LEAKY_5XX_MESSAGE);
    expect(serialized).toContain("KEK_UNAVAILABLE");

    // ...and no raw credential from the request body crossed either.
    expect(serialized).not.toContain(VALID_BODY.api_key);
    expect(serialized).not.toContain(VALID_BODY.api_secret);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 160-02 / RANK-03 — THE PERSIST ARM
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS, IN ECONOMIC TERMS. `api_keys.exchange` decides how a
 * strategy is annualized downstream: a crypto venue annualizes on √365, a
 * traditional venue on √252. Those differ by ~1.20×, and the number they
 * inflate is the Sharpe ratio a prospective allocator reads on a public
 * factsheet. Until this phase the row was composed by the BROWSER, so the
 * venue on it was whatever the client said — a value the server had no reason
 * to believe and every reason not to. The persist arm moves the write to the
 * server and stamps both venue columns from the venue THIS ROUTE authenticated
 * against.
 *
 * WHAT WOULD REDDEN EACH ORACLE is named per-test. The load-bearing ones:
 * change `attested_venue: exchangeNormalized` to read the body's raw
 * `exchange`, and the normalization test goes red. Relax `body.persist ===
 * true` to a truthy check, and the string-"true" skew test goes red. Spread
 * `...encrypted` into the persist response, and the no-ciphertext invariant
 * goes red.
 */
describe("POST /api/keys/validate-and-encrypt — the persist arm (160-02 / RANK-03)", () => {
  /** Every ciphertext-shaped key name the encrypt payload can carry. */
  const CIPHERTEXT_KEY_PATTERN = /encrypt|cipher|secret|nonce|dek|kek/i;

  function persistBody(overrides: Record<string, unknown> = {}) {
    return { ...VALID_BODY, persist: true, label: "My OKX key", ...overrides };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    rateLimitResult.reason = undefined;
    PERSIST_STATE.inserts.length = 0;
    PERSIST_STATE.insertResult = null;
    PERSIST_STATE.adminFactoryError = null;
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

  // ── (1) THE RANK-03 ORACLE: both venue columns, server-decided ────────────
  it("stamps exchange AND attested_venue from the SERVER-validated venue, and takes user_id from the session — never the body", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({
        ...persistBody({ exchange: "deribit" }),
        // A hostile caller naming a DIFFERENT tenant. The route must never read
        // it: `userId` reaches the INSERT only from the withAuth session
        // (threat T-160-05). Neuter that threading and this line goes red.
        user_id: "00000000-0000-0000-0000-ffffffffffff",
        // …and naming a DIFFERENT venue than the one it submitted credentials
        // for. `attested_venue` must follow the validated venue, not this.
        attested_venue: "mt5",
      }),
    );

    expect(res.status).toBe(200);
    expect(PERSIST_STATE.inserts).toHaveLength(1);
    const row = PERSIST_STATE.inserts[0];
    expect(row.__table).toBe("api_keys");
    // BOTH columns against the SAME hand-typed venue. That is also what pins
    // the coupling the DB CHECK enforces (a divergence caught in CI rather than
    // as a 23514 in production) — and it pins it INDEPENDENTLY. A bare
    // `expect(row.attested_venue).toBe(row.exchange)` stood here and could not
    // fail once these two passed; worse, on its own it is satisfied by a row
    // whose columns were BOTH forged to the same wrong venue (review F3).
    expect(row.exchange).toBe("deribit");
    expect(row.attested_venue).toBe("deribit");
    expect(row.user_id).toBe(TEST_USER.id);
    expect(row.user_id).not.toBe("00000000-0000-0000-0000-ffffffffffff");
    // The ciphertext still reaches the ROW (it has to — that is the key), it
    // simply stops reaching the browser. See the response oracle below.
    expect(row.api_key_encrypted).toBe("ct-blob");
    expect(row.dek_encrypted).toBe("dek-ct");
    // ⭐ 160 review F1 — TOTALITY, not a sample. The two assertions above pin
    // 2 of the 6 fields the encrypt contract declares; `nonce`, `kek_version`,
    // `api_secret_encrypted` and `passphrase_encrypted` were asserted NOWHERE,
    // so deleting any of them from the route's projection was invisible to this
    // suite. That is not a cosmetic gap: `kek_version` is INTEGER NOT NULL
    // DEFAULT 1, so its omission INSERTs successfully and mislabels the KEK the
    // blob is wrapped under — the row decrypts nowhere, in another service,
    // days later, with no error anywhere. Driven off `.shape` rather than a
    // second hand-written list so it grows with the contract: a seventh schema
    // field the route forgets to write reddens HERE as well as at `tsc`.
    for (const field of Object.keys(EncryptKeyResponseSchema.shape)) {
      expect(row, `the insert projection dropped ${field}`).toHaveProperty(field);
    }
  });

  // ── (1b) THE SECOND FORGERY VECTOR: the encryptKey RESPONSE, not the body ──
  // 160 review WR-01. The oracle above pins the REQUEST body. It says nothing
  // about the upstream analytics-service response, which is spread into the same
  // INSERT — and a spread that lands AFTER the provenance columns would overwrite
  // the tenant and both venue columns. The only thing that stood between a
  // compromised/regressed upstream and a forged row was `EncryptKeyResponseSchema`
  // being strip-mode Zod, two modules away in a file with a sanctioned
  // `.passthrough()` sibling. RANK-03 is precisely the claim "the venue the server
  // validated is the venue that gets written", so it must not rest on a distant
  // schema's mode — it now rests on the object literal's own key order.
  //
  // ⚠️ ANTI-VACUITY, AND THE RECEIPT IS MEASURED (160-05 review F3). This test
  // poisons the mock at the seam the schema guards, so it exercises the ordering
  // DIRECTLY. Move the `...encrypted` spread back below the explicit columns in
  // route.ts and the poisoned `user_id` lands in the row: the
  // `expect(row.user_id).toBe(TEST_USER.id)` assertion reddens FIRST and vitest
  // aborts the test there. Both venue assertions would redden too if reached,
  // because each is pinned to the hand-typed EXPECTED_VENUE — the poisoned
  // "mt5" cannot satisfy either. The `api_key_encrypted` assertion is the
  // preserve side and stays green under that neuter by design.
  //
  // ⛔ The previous fourth assertion was `expect(row.attested_venue).toBe(
  // row.exchange)` — two fields of the SAME row compared to each other. Under
  // the exact regression this test exists to catch, the poisoned response sets
  // BOTH to "mt5", so that oracle PASSED. Self-referential oracles are not
  // oracles; both columns are now compared to an independent expectation.
  it("a poisoned encryptKey RESPONSE cannot override user_id or either venue column (spread order)", async () => {
    // Hand-typed, and deliberately NOT read back off the row: this is the venue
    // the caller submitted credentials for and the one the server validated.
    const EXPECTED_VENUE = "deribit";
    mockEncryptKey.mockResolvedValue({
      api_key_encrypted: "ct-blob",
      api_secret_encrypted: null,
      passphrase_encrypted: null,
      dek_encrypted: "dek-ct",
      nonce: "nonce-b64",
      // Hostile extras, as if the schema had been loosened to passthrough.
      user_id: "00000000-0000-0000-0000-eeeeeeeeeeee",
      exchange: "mt5",
      attested_venue: "mt5",
      label: "forged-by-upstream",
    });

    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody({ exchange: EXPECTED_VENUE })));

    expect(res.status).toBe(200);
    expect(PERSIST_STATE.inserts).toHaveLength(1);
    const row = PERSIST_STATE.inserts[0];
    expect(row.user_id).toBe(TEST_USER.id);
    // BOTH venue columns against the SAME independent expectation — never
    // against each other. The DB CHECK's equality is a CONSEQUENCE of each
    // column carrying the venue this server authenticated against; asserting
    // only the equality would be satisfied by a row where BOTH were forged to
    // the poisoned "mt5" above.
    expect(row.exchange).toBe(EXPECTED_VENUE);
    expect(row.attested_venue).toBe(EXPECTED_VENUE);
    // The ciphertext from the same response still lands — the guard is scoped to
    // the provenance columns, it does not discard the payload we asked for.
    expect(row.api_key_encrypted).toBe("ct-blob");
  });

  // ── (2) NORMALIZATION: the CANONICAL venue lands, not the raw body string ──
  it("writes the NORMALIZED venue to both columns for a mixed-case 'MT5' (not the raw body string)", async () => {
    process.env.MT5_ENABLED = "true";
    const { POST } = await import("./route");
    const res = await POST(
      makeReq({ ...MT5_BODY, exchange: "MT5", persist: true, label: "Broker" }),
    );

    expect(res.status).toBe(200);
    expect(PERSIST_STATE.inserts).toHaveLength(1);
    // The api_keys CHECK admits lowercase venue codes only. If either column
    // were written from `body.exchange` instead of the route's own
    // `exchangeNormalized`, this row would carry "MT5" and 23514 in production.
    expect(PERSIST_STATE.inserts[0].exchange).toBe("mt5");
    expect(PERSIST_STATE.inserts[0].attested_venue).toBe("mt5");
  });

  // ── (3) NO CIPHERTEXT LEAVES THE SERVER ON THE PERSIST PATH ───────────────
  it("returns api_key_id and NO ciphertext-named field of any kind", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      api_key_id: "persisted-key-id",
      valid: true,
      read_only: true,
    });
    // The exact-match above already pins this, but the pattern assertion is
    // what survives a future field being ADDED to the response: whoever adds
    // one has to justify a name that is not ciphertext-shaped.
    expect(Object.keys(body).filter((k) => CIPHERTEXT_KEY_PATTERN.test(k))).toEqual([]);
    // Ciphertext is per-tenant even in its absence — the id is too.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  // ── (4) THE LABEL becomes server-written text ─────────────────────────────
  it("falls back to the server default label when none is supplied", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody({ label: undefined })));

    expect(res.status).toBe(200);
    expect(PERSIST_STATE.inserts[0].label).toBe("okx key");
  });

  it("falls back to the server default when the label is whitespace-only", async () => {
    const { POST } = await import("./route");
    await POST(makeReq(persistBody({ label: "   " })));

    expect(PERSIST_STATE.inserts[0].label).toBe("okx key");
  });

  it("CAPS an over-long label at 120 chars rather than failing an already-validated connect", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody({ label: "L".repeat(500) })));

    // The connect SUCCEEDS — a cosmetic display string must not cost the user
    // a live venue round-trip they already passed.
    expect(res.status).toBe(200);
    expect(PERSIST_STATE.inserts[0].label).toBe("L".repeat(120));
  });

  it("ignores a non-string label (server default), never coercing it into the row", async () => {
    const { POST } = await import("./route");
    await POST(makeReq(persistBody({ label: { evil: true } })));

    expect(PERSIST_STATE.inserts[0].label).toBe("okx key");
  });
});

/**
 * 160-05 / RANK-03 — THE LEGACY ARM IS RETIRED (threat T-160-06).
 *
 * The skew window these cases were born in is closed: `REVOKE INSERT` withdrew
 * `api_keys` INSERT from `anon`/`authenticated`, so the stale tab that sends
 * the OLD body can no longer write the row it was being handed ciphertext for.
 * Absent-discriminator bodies now get a coded `STALE_CLIENT` refusal, and the
 * route has NO arm that returns key material to a caller.
 *
 * Two properties are pinned here and they fail differently:
 *
 *   1. NO CIPHERTEXT ON THE WIRE — the SECOND line of defence, not the first.
 *      Restore the legacy `return NextResponse.json({ ...encrypted, … })` and
 *      the refusal becomes a 200 carrying key material.
 *
 *      ⚠️ 160-05 review F2 — THE REDDEN PATH, CORRECTED. This docblock used to
 *      claim `expectsNoCipherText` reddens on every case under that neuter. It
 *      did not, and could not: with a HARD `expect(res.status).toBe(409)` the
 *      restored arm threw `expected 200 to be 409` two lines earlier and vitest
 *      aborted the test, so the helper never ran. Its only reachable failure was
 *      the literal `{ error, code: "STALE_CLIENT" }` object growing a
 *      ciphertext-named key — something this route cannot produce, since
 *      `encrypted` is not even in scope at the gate. So the helper was a false
 *      receipt.
 *
 *      It is now genuinely falsifiable, by two deliberate choices below: the
 *      status pin is `expect.soft` (the test still FAILS on a wrong status — it
 *      just fails after the remaining oracles have run), and
 *      `expectsNoCipherText` is the FIRST body assertion, ahead of anything that
 *      could throw and abort. A restored legacy arm therefore reaches the helper
 *      with the ciphertext body in hand. The helper asserts over KEY NAMES, not
 *      fixture values, so a renamed ciphertext field cannot slip past it.
 *
 *      The 200 persist path is NOT policed here — it has its own primary
 *      oracles: the persist arm's "returns api_key_id and NO ciphertext-named
 *      field of any kind" case, and the "NO persist-mode response — success or
 *      any error arm — carries a ciphertext-named field" sweep. This suite owns
 *      the REFUSAL path only, and does not duplicate them.
 *   2. STRICTNESS still discriminates. Relax `body.persist !== true` to a
 *      falsy check and the `"true"` / `1` / `"1"` / `{}` probes stop refusing —
 *      they would reach the WRITER, which is the double-write threat wearing a
 *      different hat now that the server is the only writer.
 *
 * `PERSIST_STATE.inserts` staying EMPTY remains the anti-double-write pin.
 */
describe("POST /api/keys/validate-and-encrypt — the retired legacy arm refuses, and serves no ciphertext", () => {
  /** Every ciphertext-shaped key the legacy envelope used to carry. */
  const CIPHERTEXT_KEYS = [
    "api_key_encrypted",
    "api_secret_encrypted",
    "passphrase_encrypted",
    "dek_encrypted",
    "nonce",
    "kek_version",
  ];

  function expectsNoCipherText(body: Record<string, unknown>) {
    expect(
      Object.keys(body).filter((k) => CIPHERTEXT_KEYS.includes(k)),
      "the refusal envelope carries a ciphertext-shaped key — the legacy arm " +
        "is back, or a new arm started echoing encryptKey's result",
    ).toEqual([]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    rateLimitResult.reason = undefined;
    PERSIST_STATE.inserts.length = 0;
    PERSIST_STATE.insertResult = null;
    PERSIST_STATE.adminFactoryError = null;
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

  it("a body with NO persist field is REFUSED with STALE_CLIENT and mints ZERO rows", async () => {
    const { POST } = await import("./route");
    const res = await POST(makeReq(LEGACY_BODY));

    // SOFT ON PURPOSE (review F2 — see the suite docblock): a restored legacy
    // arm answers 200 with ciphertext, and a hard status assertion would abort
    // the test before the ciphertext oracle could look at the body. Soft still
    // fails this test on a wrong status; it just fails it last.
    expect.soft(res.status).toBe(409);
    const body = await res.json();
    // FIRST among the body assertions, ahead of anything that could throw: this
    // is the oracle a restored legacy arm has to trip.
    expectsNoCipherText(body);
    expect(body.code).toBe("STALE_CLIENT");
    // The message is what a stale tab actually shows its user, so it has to
    // name the remedy (reload) rather than blame the key.
    expect(body.error).toMatch(/reload/i);
    // Review F4 — the 409 is the one coded arm on this route with no
    // behavioural header pin. `src/__tests__/no-store-coverage.test.ts` is a
    // TOTAL-REMOVAL tripwire only, so deleting `headers: NO_STORE_HEADERS` from
    // THIS arm reddened nothing. The refusal names a tenant's client state and
    // the request that produced it carried raw exchange credentials.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(PERSIST_STATE.inserts).toEqual([]);
  });

  it("the refusal happens BEFORE any live venue call — no validate, no encrypt", async () => {
    const { POST } = await import("./route");
    await POST(makeReq(LEGACY_BODY));

    // A doomed request must not spend a credential probe against the exchange
    // or a KMS round-trip. Move the gate below the handler call and both of
    // these redden.
    expect(mockValidateKey).not.toHaveBeenCalled();
    expect(mockEncryptKey).not.toHaveBeenCalled();
  });

  it.each([
    ["the STRING \"true\"", "true"],
    ["the number 1", 1],
    ["the string \"1\"", "1"],
    ["an object", {}],
    ["null", null],
    ["false", false],
  ])(
    "persist as %s is NOT the discriminator — refused, zero server-side inserts",
    async (_label, persistValue) => {
      const { POST } = await import("./route");
      const res = await POST(
        makeReq({ ...VALID_BODY, persist: persistValue, label: "ignored" }),
      );

      // Soft + oracle-first, same reason as the case above (review F2).
      expect.soft(res.status).toBe(409);
      const body = await res.json();
      // No key material (the arm that used to hand that out is gone) …
      expectsNoCipherText(body);
      expect(body.code).toBe("STALE_CLIENT");
      // … and no id, because it never reached the writer.
      expect(body.api_key_id).toBeUndefined();
      expect(PERSIST_STATE.inserts).toEqual([]);
    },
  );
});

/**
 * 160-02 / RANK-03 Task 2 — THE PERSIST ARM'S FAILURE SURFACE.
 *
 * The tracer proved the happy path. These pin the arms a happy path never
 * visits: the limiter must police BOTH arms identically (a persist arm that
 * skipped it would be a brand-new unthrottled entry point into a live
 * credential probe — threat T-160-09); an upstream validation failure must
 * mint nothing; and an INSERT fault must be honest about what happened without
 * echoing raw Postgres text at the user or raw credentials at the log sinks.
 */
describe("POST /api/keys/validate-and-encrypt — persist-arm failure surface (160-02 Task 2)", () => {
  const CIPHERTEXT_KEY_PATTERN = /encrypt|cipher|secret|nonce|dek|kek/i;

  function persistBody(overrides: Record<string, unknown> = {}) {
    return { ...VALID_BODY, persist: true, label: "My OKX key", ...overrides };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitResult.success = true;
    rateLimitResult.retryAfter = 0;
    rateLimitResult.reason = undefined;
    PERSIST_STATE.inserts.length = 0;
    PERSIST_STATE.insertResult = null;
    PERSIST_STATE.adminFactoryError = null;
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

  // ── Test 1: limiter parity ────────────────────────────────────────────────
  it("the rate limiter polices the persist arm identically — same coded envelope, same headers, zero inserts", async () => {
    rateLimitResult.success = false;
    rateLimitResult.retryAfter = 17;

    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody()));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(await res.json()).toEqual({
      error: "Too many requests",
      code: "KEY_RATE_LIMIT",
    });
    // The limiter sits ABOVE the arm split, so a persist request cannot become
    // an unthrottled path to a live credential probe.
    expect(mockValidateKey).not.toHaveBeenCalled();
    expect(mockEncryptKey).not.toHaveBeenCalled();
    expect(PERSIST_STATE.inserts).toEqual([]);
  });

  // ── Test 2: upstream validation failure ⇒ nothing is minted ───────────────
  it("an upstream credential rejection forwards the curated 4xx and mints NO row", async () => {
    const { AnalyticsUpstreamError } = await import("@/lib/analytics-client");
    mockValidateKey.mockRejectedValue(
      new AnalyticsUpstreamError("Invalid API credentials", 400, "KEY_AUTH_FAILED"),
    );

    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody()));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid API credentials", code: "KEY_AUTH_FAILED" });
    // A key that did not authenticate must never become an ATTESTED row — the
    // attestation is precisely the claim "this server saw this key work here".
    expect(PERSIST_STATE.inserts).toEqual([]);
    expect(mockEncryptKey).not.toHaveBeenCalled();
    expect(Object.keys(body).filter((k) => CIPHERTEXT_KEY_PATTERN.test(k))).toEqual([]);
  });

  it("a read_only:false verdict mints NO row (the honest backstop copy, persist mode)", async () => {
    mockValidateKey.mockResolvedValue({ valid: true, read_only: false });

    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody()));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_NOT_READ_ONLY");
    expect(PERSIST_STATE.inserts).toEqual([]);
  });

  // ── Test 3: the INSERT itself rejects ─────────────────────────────────────
  it("an INSERT rejection answers a coded 500 that does NOT echo the raw Postgres text, and scrubs credentials at BOTH sinks", async () => {
    const RAW_PG =
      'new row for relation "api_keys" violates check constraint ' +
      '"api_keys_attested_venue_matches_exchange" (SQLSTATE 23514) ' +
      "DETAIL: Failing row contains (okx-api-key, okx-api-secret)";
    PERSIST_STATE.insertResult = { data: null, error: { message: RAW_PG, code: "23514" } };
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody()));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("UNKNOWN");
    // (a) The USER gets curated copy that is honest about the split outcome —
    // the key validated, the save did not — and carries no DB internals.
    expect(body.error).toBe(
      "Your key was verified but couldn't be saved. Please try again.",
    );
    expect(body.error).not.toContain("SQLSTATE");
    expect(body.error).not.toContain("api_keys");
    expect(body.error).not.toContain("check constraint");
    expect(Object.keys(body).filter((k) => CIPHERTEXT_KEY_PATTERN.test(k))).toEqual([]);

    // (b) The OPERATOR gets the fault — silence here is how a never-saved key
    // becomes undiagnosable (Rule 12) …
    //
    // ⚠️ THE SERIALIZER IS LOAD-BEARING, AND THIS COMMENT IS THE RECEIPT.
    // Written first as `args.map(String)`, this assertion was VACUOUS: a
    // PostgREST error is a PLAIN OBJECT, `String({...})` is "[object Object]",
    // and so `not.toContain("okx-api-key")` passed no matter what the route
    // did. Measured — deleting `scrubSeamError` from the route left all 77
    // tests green. JSON-stringifying non-string args is what makes the
    // un-scrubbed object's contents visible to the assertion, so removing the
    // scrub now reddens this test. Do not "simplify" this back to String().
    const serializeArg = (a: unknown): string => {
      if (typeof a === "string") return a;
      try {
        return JSON.stringify(a) ?? String(a);
      } catch {
        return String(a);
      }
    };
    const logged = consoleErr.mock.calls
      .map((args) => args.map(serializeArg).join(" "))
      .join("\n");
    expect(logged).toContain("persist INSERT failed");
    // The scrub must not eat the diagnosis: the constraint name is how an
    // operator identifies WHICH invariant the write violated.
    expect(logged).toContain("api_keys_attested_venue_matches_exchange");
    // … but the DETAIL clause echoed the caller's raw credentials back, and a
    // PostgREST error routinely does exactly that. They must not survive to the
    // log line.
    expect(logged).not.toContain("okx-api-key");
    expect(logged).not.toContain("okx-api-secret");

    // (c) Sentry is a THIRD PARTY, so the per-request secret list must be named
    // at that sink too — no module-level env list can know these values.
    expect(captureSpy).toHaveBeenCalled();
    const sentrySecrets = captureSpy.mock.calls[0][1].secrets;
    expect(sentrySecrets).toContain("okx-api-key");
    expect(sentrySecrets).toContain("okx-api-secret");

    consoleErr.mockRestore();
  });

  it("an INSERT that returns no row (no error either) is still a failure, not a silent success", async () => {
    // The shape that makes a false success possible: PostgREST answered without
    // an error but handed back nothing. Reporting 200 here would tell the user
    // the key was saved and hand the component an undefined id.
    PERSIST_STATE.insertResult = { data: null, error: null };
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody()));

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("UNKNOWN");

    consoleErr.mockRestore();
  });

  // ── The missing service credential ────────────────────────────────────────
  it("a missing service-role credential answers SEAM_MISCONFIGURED — never a sentence blaming the user's key", async () => {
    PERSIST_STATE.adminFactoryError = new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY for admin operations",
    );
    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("./route");
    const res = await POST(makeReq(persistBody()));

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({
      error: "Service credential unavailable",
      code: "SEAM_MISCONFIGURED",
    });
    // OUR missing config must not surface as the user's key being at fault —
    // the same distinction the 503-vs-429 limiter arm draws above.
    expect(body.error).not.toMatch(/key validation failed/i);
    expect(body.error).not.toContain("SUPABASE");
    expect(PERSIST_STATE.inserts).toEqual([]);

    consoleErr.mockRestore();
  });

  // ── Test 4: the invariant across EVERY persist-mode arm ───────────────────
  it("NO persist-mode response — success or any error arm — carries a ciphertext-named field", async () => {
    const { POST } = await import("./route");
    const { AnalyticsUpstreamError, AnalyticsTimeoutError } = await import(
      "@/lib/analytics-client"
    );

    // Each entry: a label, the setup that drives that arm, and nothing else.
    const arms: Array<[string, () => void]> = [
      ["success", () => {}],
      [
        "insert fault",
        () => {
          PERSIST_STATE.insertResult = {
            data: null,
            error: { message: "boom", code: "XX000" },
          };
        },
      ],
      [
        "no service credential",
        () => {
          PERSIST_STATE.adminFactoryError = new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
        },
      ],
      [
        "upstream 4xx",
        () => {
          mockValidateKey.mockRejectedValue(
            new AnalyticsUpstreamError("Invalid API credentials", 400, "KEY_AUTH_FAILED"),
          );
        },
      ],
      [
        "read_only false",
        () => {
          mockValidateKey.mockResolvedValue({ valid: true, read_only: false });
        },
      ],
      [
        "upstream timeout",
        () => {
          mockValidateKey.mockRejectedValue(
            new AnalyticsTimeoutError("/api/validate-key", 30000),
          );
        },
      ],
      [
        "terminal unclassified",
        () => {
          mockValidateKey.mockRejectedValue(new Error("crypto: internal failure"));
        },
      ],
      [
        "rate limited",
        () => {
          rateLimitResult.success = false;
          rateLimitResult.retryAfter = 5;
        },
      ],
    ];

    const consoleErr = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [label, setup] of arms) {
      // Reset to the happy baseline, then drive exactly one arm.
      PERSIST_STATE.inserts.length = 0;
      PERSIST_STATE.insertResult = null;
      PERSIST_STATE.adminFactoryError = null;
      rateLimitResult.success = true;
      rateLimitResult.retryAfter = 0;
      mockValidateKey.mockResolvedValue({ valid: true, read_only: true });
      setup();

      const res = await POST(makeReq(persistBody()));
      const body = await res.json();
      expect(
        Object.keys(body).filter((k) => CIPHERTEXT_KEY_PATTERN.test(k)),
        `persist-mode arm "${label}" leaked a ciphertext-named field`,
      ).toEqual([]);
    }
    consoleErr.mockRestore();
  });
});
