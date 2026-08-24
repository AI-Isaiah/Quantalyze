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
// 161-09 / WIZERR-08 (F3) — the disclosure oracles, imported LIVE rather than
// hand-listed. A hand-typed venue list in a test is itself a stale disclosure
// claim the day the offer changes: it keeps passing while the route discloses
// something it no longer describes. These are STATIC imports, so the two cases
// that `vi.doMock("@/lib/utils")` to reach the sfox half-state do not perturb
// them — those cases assert on their own arms, not on these bounds.
import { UI_EXCHANGE_CODES } from "@/lib/utils";
import { SUPPORTED_EXCHANGES } from "@/lib/closed-sets";

const verifyStrategyMock = vi.fn();
// Daily-cap count returned by the admin verification_requests head/count
// select. Mutated per test to drive the 429 branch.
let verificationCount = 0;

vi.mock("server-only", () => ({}));

vi.mock("@/lib/csrf", () => ({
  assertSameOrigin: () => null,
}));

/**
 * 140.4-13 / SEAMRIM-05 — the limiter verdict this file drives the route with.
 *
 * Hoisted so the `vi.mock` factory can close over it and each test can pick the
 * outcome without re-mocking. Default is the ALLOW the pre-existing tests were
 * written against, and the SEAMRIM-05 describe below restores it in `afterEach`
 * so no ordering dependency is created.
 */
const limiter = vi.hoisted(() => ({
  result: { success: true, retryAfter: 0 } as
    | { success: true; retryAfter?: number }
    | { success: false; retryAfter: number; reason?: "ratelimit_misconfigured" },
}));

/**
 * ⚠️ EXTENDED, NOT REPLACED (140.4-13). The factory used to omit
 * `rateLimitDenyJson`; now that the route routes its deny through the
 * chokepoint, an omitted export would be `undefined` at call time and throw
 * from inside the handler. The pure helpers come from `importActual` rather
 * than a hand-written double SO THE MOCK CANNOT DRIFT FROM THE REAL 503-vs-429
 * DECISION — a double that always answered 429 would make this file green on
 * precisely the bug the plan closes.
 */
vi.mock("@/lib/ratelimit", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ratelimit")>();
  return {
    publicIpLimiter: null,
    checkLimit: async () => limiter.result,
    getClientIp: () => "127.0.0.1",
    rateLimitDenyJson: actual.rateLimitDenyJson,
    isRateLimitMisconfigured: actual.isRateLimitMisconfigured,
  };
});

vi.mock("@/lib/analytics-client", () => {
  // Real-shape error classes so the route's `err instanceof AnalyticsUpstreamError`
  // narrowing resolves against the same constructor identity (F5b R8).
  class AnalyticsUpstreamError extends Error {
    readonly status: number;
    // 161-06 / WIZERR-05 — this double had drifted FURTHEST: it never picked up
    // `seamCode` (140.3-01) or `dependency` (140.3-11) either, so it is brought
    // to the real class's full shape in one go. All three are additive and
    // optional; every pre-existing 2-arg construction in this file keeps
    // defaulting and keeps passing.
    // ⚠️ ORDER IS THE POINT, not just presence — a positional argument must
    // land in the same field here as it does at the seam.
    // `analytics-upstream-error.parity.invariant.test.ts` now enforces it.
    readonly seamCode: string | null;
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
    verifyStrategy: verifyStrategyMock,
    AnalyticsUpstreamError,
    AnalyticsTimeoutError,
  };
});

// F5b (R8): spy on captureToSentry so the 5xx-redaction test can pin that the
// internal detail still reaches Sentry now that err.message is no longer echoed.
const captureSpy = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: captureSpy }));

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

/**
 * 140.4-13 / SEAMRIM-05 — the limiter deny arm, all THREE outcomes.
 *
 * ⚠️ THIS ROUTE IS THE PUBLIC/ANONYMOUS AUTH SHAPE. A first-time visitor
 * evaluating the product hits it with no account. Before this plan a limiter
 * MISCONFIGURATION on our side answered 429 "Too many requests" — our outage,
 * rendered as the visitor's fault, on their very first click.
 *
 * The 429 case is the ANTI-REGRESSION half and it matters more than the 503:
 * throttling is the common outcome and its body is a live contract.
 */
describe("[140.4-13 / SEAMRIM-05] POST /api/verify-strategy — the limiter deny arm", () => {
  afterEach(() => {
    limiter.result = { success: true, retryAfter: 0 };
    vi.restoreAllMocks();
  });

  it("ratelimit_misconfigured → 503, NOT a 429 blaming the caller", async () => {
    limiter.result = {
      success: false,
      retryAfter: 60,
      reason: "ratelimit_misconfigured",
    };
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Rate limiter unavailable" });
    expect(res.headers.get("Retry-After")).toBe("60");
    // Nothing downstream ran: the deny is the whole response.
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  it("a genuine throttle → 429 with a BYTE-IDENTICAL body and headers", async () => {
    limiter.result = { success: false, retryAfter: 42 };
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(429);
    // Hand-typed from the pre-adoption source, not read back off the builder.
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(res.headers.get("Retry-After")).toBe("42");
    // This route is the ONE seam route whose 429 carries no NO_STORE_HEADERS.
    // Adoption must not have added one.
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  it("success → the deny arm does NOT fire and the request runs on past it", async () => {
    limiter.result = { success: true, retryAfter: 0 };
    verifyStrategyMock.mockResolvedValue({
      verification_id: "22222222-2222-2222-2222-222222222222",
    });
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    // ⚠️ NOT `expect(status).not.toBe(503)`. This route answers its OWN 503
    // downstream when `INTERNAL_API_TOKEN` is unset, which is the case in this
    // suite — a status-only oracle here would assert the wrong fact and would
    // have to be weakened later. The limiter's deny arm is identified by the
    // `Retry-After` header it stamps and by its body, and neither is present.
    expect(res.status).not.toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
    const body = await res.json();
    expect(body.error).not.toBe("Too many requests");
    expect(body.error).not.toBe("Rate limiter unavailable");
  });
});

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

  it("returns 400 'Unsupported exchange' when the exchange is not in UI_EXCHANGE_CODES", async () => {
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...VALID_BODY, exchange: "kraken" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Unsupported exchange");
    expect(verifyStrategyMock).not.toHaveBeenCalled();
  });

  // F3 (Phase 122): sfox is in the widened key-save allowlist SUPPORTED_EXCHANGES
  // but NOT in the public OFFERED set — so this public teaser must reject it
  // cleanly WITHOUT disclosing it (no half-accept → no confusing downstream 422)
  // and WITHOUT leaking "sfox" into the error enum shown to anon callers.
  it.each(["sfox", "sFOX", "SFOX"])(
    "rejects %s cleanly and never discloses sfox in the error enum (F3)",
    async (exchange) => {
      const { POST } = await import("./route");
      const res = await POST(postReq({ ...VALID_BODY, exchange }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Unsupported exchange");
      // The disclosed "Supported: …" enum must NOT name sfox pre-launch.
      expect(body.error.toLowerCase()).not.toContain("sfox");
      // Never forwarded to the teaser pipeline (no half-accept).
      expect(verifyStrategyMock).not.toHaveBeenCalled();
    },
  );

  // Specialist finding (LOW): the public teaser gated sfox ONLY on the client
  // OFFER flag (UI_EXCHANGE_CODES ← NEXT_PUBLIC_SFOX_ENABLED), not the SERVER
  // go-live flag (isSfoxEnabledServer ← SFOX_ENABLED) its 3 sibling key routes
  // enforce. In the documented half-state (NEXT_PUBLIC on, SFOX_ENABLED off) the
  // offer set admits sfox, so without the server gate the teaser would forward a
  // live sfox key-process before go-live. This pins the structural server gate.
  it("fails closed on the SERVER gate in the half-state (offer on, SFOX_ENABLED off)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/utils", async () => {
      const actual = (await vi.importActual("@/lib/utils")) as Record<string, unknown>;
      const codes = actual.UI_EXCHANGE_CODES as string[];
      return { ...actual, UI_EXCHANGE_CODES: [...codes, "sfox"] }; // offer on
    });
    vi.doMock("@/lib/closed-sets", async () => {
      const actual = (await vi.importActual("@/lib/closed-sets")) as Record<string, unknown>;
      return { ...actual, isSfoxEnabledServer: () => false }; // server flag OFF
    });
    try {
      const { POST } = await import("./route");
      const res = await POST(postReq({ ...VALID_BODY, exchange: "sfox" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("not yet available");
      // Never forwarded to the teaser pipeline despite passing the offer gate.
      expect(verifyStrategyMock).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/utils");
      vi.doUnmock("@/lib/closed-sets");
      vi.resetModules();
    }
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
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: true,
        response: null,
        body: {
          // 140.3-02 / TS-12 — `ok: true` + an explicit `code: null` are what the
          // real terminal-success builder emits; this double previously omitted
          // them, i.e. it disagreed with the contract it stands in for. The route
          // now reads the discriminator, so the FIXTURE is corrected — the
          // trust_tier assertion below is untouched and just as strong.
          ok: true,
          code: null,
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
 * This test drives the unified handler (the only path since Phase 106) and
 * asserts that the response contains NONE of the sensitive upstream fields,
 * even when the upstream mock injects them.
 *
 * Pre-fix: `return NextResponse.json({ ...upstream, verification_id, ... })`
 * spread the entire upstream blob → encrypted_credentials leaked.
 * Post-fix: explicit allowlist → only verification_id/public_token/expires_at
 * (+ optional metrics_snapshot/status).
 */
describe("NEW-C35-01 — unified path does not spread encrypted_credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verificationCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("response body contains NO encrypted_credentials even when upstream injects them", async () => {
    // Mock process-key-client to return a response that includes sensitive fields
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: true,
        response: null,
        body: {
          // 140.3-02 / TS-12 — see the note on the NEW-C35-02 fixture above: the
          // real terminal-success builder carries `ok: true` + `code: null`.
          // The leak assertions below are untouched.
          ok: true,
          code: null,
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

/**
 * Phase 140.3-02 / TS-12 + TS-14 — success is decided by the envelope's OWN
 * `ok` discriminator, never by sniffing a field and never by the status.
 *
 * ⚠️ WHY NOT THE STATUS (fold-in M-6 from the 140.1 code review). `validate-only`
 * answers **200 with `ok:false`** where `_scope_rejected` answers **403**, on the
 * IDENTICAL `not val.valid` predicate. It was judged a deliberate carve-out, but
 * `STATUS_CONTRACT.md` records the exception nowhere. A consumer branching on
 * STATUS is therefore wrong on one of the two paths no matter which status it
 * picks. Branching on `ok` is correct on both. Do NOT "simplify" this back.
 *
 * ⚠️ WHY NOT `verification_id`. The route used to decide success by
 * `typeof upstream.verification_id === "string"`. The Python terminal-success
 * builder's own docstring (`process_key.py`, the `flow_type=teaser` return) names
 * this exact site as the shape consumers used to SNIFF, and adds `ok: true` +
 * `code: null` precisely so they stop. A sniff cannot tell a success carrying an
 * id from a FAILURE carrying an id.
 *
 * ORACLE INDEPENDENCE: every fixture key and expected value is a hand-typed
 * literal, taken from the Python builders' key sets, not imported from anything.
 */
describe("[140.3-02 / TS-12] POST /api/verify-strategy — success is decided by `ok`, not by sniffing verification_id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verificationCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("A 200 carrying `ok: false` is NEVER treated as a verification — no public_token is minted", async () => {
    const updateSpy = vi
      .fn()
      .mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from(table: string) {
          if (table === "strategy_verifications") return { update: updateSpy };
          throw new Error(`unexpected: ${table}`);
        },
      }),
    }));
    // A FAILURE envelope that nonetheless carries a top-level verification_id.
    // The old `typeof upstream.verification_id === "string"` sniff reads this as
    // a success and publishes a teaser factsheet for a key that FAILED
    // validation, complete with a queryable public_token.
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          ok: false,
          code: "AUTH_FAILED",
          human_message: "Those API credentials were rejected by the exchange.",
          correlation_id: "11111111-2222-3333-4444-555555555555",
          recoverable: false,
          verification_id: "88888888-8888-8888-8888-888888888888",
        },
      }),
    }));

    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    const body = await res.json();

    expect(
      res.status,
      "A 200 whose envelope says `ok: false` is a FAILURE. Deciding success by " +
        "the presence of a verification_id mints a public_token for a key the " +
        "exchange rejected — TS-12.",
    ).not.toBe(200);
    expect(body).not.toHaveProperty("public_token");
    // And nothing was written: no row is stamped with a token for a failure.
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("PIN — a 200 carrying `ok: true` but NO verification_id is still refused (the shape guard is DRIFT cover, not rejection cover)", async () => {
    // ⚠️ FINDING recorded against TS-12's premise. The plan called this guard's
    // rejection case dead and said to DELETE the guard. Its REJECTION trigger is
    // indeed dead — a rejection returns at the client's `!result.ok` fork above.
    // Its DRIFT trigger is NOT: a 2xx whose body lost `verification_id` reaches
    // here. Deleting the guard would emit 200 + a public_token persisted to
    // `.eq("id", null)` — a token queryable against no row, which is the
    // "silent success on failure" defect this phase exists to close, and the
    // exact twin of the `isUuid` guard TS-13 says to KEEP one route over.
    // This case is GREEN before and after the change BY DESIGN — that is what
    // makes it a pin rather than a falsifier.
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
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { ok: true, code: null, status: "published" },
      }),
    }));

    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).not.toHaveProperty("public_token");
  });

  it("the terminal success (`ok: true`, `code: null`, verification_id) still mints and returns a public_token", async () => {
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
    // Hand-typed from the Python terminal-success builder's key set.
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          ok: true,
          code: null,
          verification_id: "99999999-9999-9999-9999-999999999999",
          status: "published",
          trust_tier: "api_verified",
          metrics_snapshot: { twr: 0.12 },
        },
      }),
    }));

    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verification_id).toBe("99999999-9999-9999-9999-999999999999");
    expect(typeof body.public_token).toBe("string");
    expect(body.status).toBe("published");
  });
});

/**
 * 140.3-13a / SEAMUX-08 — this route captures to Sentry, under the ONE policy
 * written out in full in `src/app/api/admin/match/eval/route.ts`.
 *
 * ⚠️ SCOPE OF THIS FILE'S ORACLE, STATED SO IT IS NOT OVERSOLD. This file mocks
 * `@/lib/sentry-capture` wholesale (line ~68, pre-existing), so the scrub —
 * which lives INSIDE that helper (SEAMCORE-06) — never runs here. These cases
 * therefore prove the CALL SITE: that the policy's arms fire, that the
 * non-policy arms do not, and that every capture NAMES its per-request
 * credentials in `secrets`. That last one is the falsifiable half: drop
 * `perRequestSecrets` from any arm and these redden.
 *
 * The end-to-end proof that a named secret is actually REMOVED — and that the
 * syscall token SURVIVES — is in `route.seam.test.ts`, which runs the real
 * helper over a faked Sentry transport. Splitting it is not a convenience: a
 * "no secret in the payload" assertion written HERE would pass with the
 * scrubber deleted, which is exactly the vacuous-oracle shape this phase keeps
 * finding.
 *
 * ⚠️ THIS ROUTE IS STILL THE SECRET-BEARING ONE OF THIS PLAN'S FOUR, BUT WHAT
 * IT HOLDS CHANGED (Phase 146.1 / B2, 2026-08-18). It carries the caller's RAW
 * exchange `api_key` / `api_secret` in the OUTGOING BODY. It no longer holds a
 * live end-user Supabase JWT: the `X-User-Access-Token` forward TS-15 added was
 * removed because the only Python reader (`services/db.py
 * get_user_scoped_supabase`) has ZERO callers, pinned by
 * `tests/test_process_key.py:2220-2221`.
 *
 * ⛔ THE `secrets` CASES BELOW WERE NARROWED, NOT WEAKENED. They still assert
 * that every capture NAMES its per-request credentials, and both survivors are
 * still unknowable to any module-level env list — which is the entire property.
 * `140.3-02` closed a live end-user JWT log leak; an observability channel added
 * here must not re-open it through Sentry for whatever the route carries next.
 */
describe("[140.3-13a / SEAMUX-08] POST /api/verify-strategy — Sentry capture policy", () => {
  /** A live-shaped Supabase JWT, long enough to clear the redaction floor. */
  const LIVE_JWT =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.s3cr3t-s1gnatur3-v4lu3";
  const RAW_API_KEY = "AK_LIVE_9f3a1c7e5b2d84a6f0c1e3d5";
  const RAW_API_SECRET = "SEC_kX7pQ2mN9vB4tR8sL1wY6hG3jD5fA0cZ";

  const SECRET_BODY = {
    email: "test@example.com",
    exchange: "okx",
    api_key: RAW_API_KEY,
    api_secret: RAW_API_SECRET,
  };

  /**
   * A session IS readable.
   *
   * ⚠️ 146.1 / B2 — KEPT READABLE ON PURPOSE even though the route no longer
   * reads it for `X-User-Access-Token`. A readable session is what makes "the
   * JWT is NOT named in `secrets`" a real observation rather than a vacuous one:
   * the value exists and is still not carried.
   */
  function mockSessionPresent() {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getSession: async () => ({
            data: { session: { access_token: LIVE_JWT } },
            error: null,
          }),
        },
      }),
    }));
  }

  function mockAdmin(update: unknown) {
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({ update }),
      }),
    }));
  }

  function mockUpstream(body: unknown) {
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
    }));
  }

  const TERMINAL_SUCCESS = {
    ok: true,
    code: null,
    verification_id: "99999999-9999-4999-8999-999999999999",
    status: "published",
  };

  /** The last capture's options, or undefined when nothing was captured. */
  function lastCapture() {
    const calls = captureSpy.mock.calls;
    return calls.length === 0
      ? undefined
      : (calls[calls.length - 1] as [
          unknown,
          {
            tags?: Record<string, string>;
            extra?: Record<string, unknown>;
            level?: string;
            secrets?: readonly unknown[];
          },
        ]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    verificationCount = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("POSITIVE: an upstream 2xx that is not a usable verification IS captured as a contract violation", async () => {
    mockSessionPresent();
    mockAdmin(vi.fn());
    // ok:false on a 2xx — drift in a contract only we can fix, and the caller
    // just sees a 502, so nothing else on this path alerts.
    mockUpstream({ ok: false, code: "AUTH_FAILED", verification_id: "x" });
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(SECRET_BODY));
    expect(res.status).toBe(502);

    const capture = lastCapture();
    expect(capture, "a contract violation reached nobody").toBeDefined();
    expect(capture![1].tags?.surface).toBe("verify-strategy");
    expect(capture![1].tags?.step).toBe("upstream-contract");
    // The SYNTHETIC error, not the raw body — which carries
    // `encrypted_credentials` and must never be handed to a third party.
    expect(capture![0]).toBeInstanceOf(Error);
  });

  it("🔴 THE SECRETS ARGUMENT: every capture NAMES both raw exchange credentials — and no longer carries the JWT at all (146.1 / B2)", async () => {
    mockSessionPresent();
    mockAdmin(vi.fn());
    mockUpstream({ ok: false, code: "AUTH_FAILED" });
    vi.resetModules();
    const { POST } = await import("./route");
    await POST(postReq(SECRET_BODY));

    const secrets = lastCapture()![1].secrets;
    expect(
      secrets,
      "no per-request secrets were named. No module-level env list can know a live user JWT or a caller's raw exchange credentials, so this array is the ONLY thing stopping undici's inlined headers reaching a third party (TRAP-1).",
    ).toBeDefined();
    expect(secrets).toContain(RAW_API_KEY);
    expect(secrets).toContain(RAW_API_SECRET);
    // ⚠️ 146.1 / B2 — INVERTED, NOT DELETED. This used to be
    // `expect(secrets).toContain(LIVE_JWT)`. The route no longer reads the
    // session, so naming the JWT here would be impossible without re-adding the
    // forward. Asserting its ABSENCE keeps the case falsifiable in the other
    // direction: if someone re-introduces the session read, this reddens and
    // they must come and decide, rather than inheriting it silently.
    expect(
      secrets,
      "the route is carrying a live end-user Supabase JWT again — its only " +
        "reader has zero callers (146.1 / B2). Re-open that deliberately.",
    ).not.toContain(LIVE_JWT);
  });

  it("POSITIVE: a createAdminClient config fault IS captured, at level fatal, with its secrets", async () => {
    mockSessionPresent();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
      },
    }));
    mockUpstream(TERMINAL_SUCCESS);
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(SECRET_BODY));
    expect(res.status).toBe(500);

    const capture = lastCapture();
    // The in-file comment on this arm has claimed "loud in logs/Sentry" since
    // it was written; until 140.3-13a the Sentry half of that was false.
    expect(capture, "the config arm's own comment promises Sentry").toBeDefined();
    expect(capture![1].tags?.step).toBe("admin-client-config");
    expect(capture![1].level).toBe("fatal");
    // 146.1 / B2 — was `toContain(LIVE_JWT)`. Probing a credential the route no
    // longer holds would assert nothing; `RAW_API_KEY` is per-request, in
    // flight, and equally unreachable by any env list, so dropping
    // `perRequestSecrets` from THIS arm still reddens here.
    expect(capture![1].secrets).toContain(RAW_API_KEY);
    expect(capture![1].secrets).not.toContain(LIVE_JWT);
  });

  it("POSITIVE: a returned persist error IS captured", async () => {
    mockSessionPresent();
    mockAdmin(
      vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: { message: "row not found" } }),
      }),
    );
    mockUpstream(TERMINAL_SUCCESS);
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(SECRET_BODY));
    expect(res.status).toBe(500);

    const capture = lastCapture();
    expect(capture).toBeDefined();
    expect(capture![1].tags?.step).toBe("public-token-persist");
    expect(capture![1].secrets).toContain(RAW_API_SECRET);
  });

  it("POSITIVE: a THROWN persist failure is captured SEPARATELY from the returned one", async () => {
    // Two separately reachable arms, so two separately named steps. A single
    // shared tag could not tell a transport failure from a returned
    // PostgrestError in triage.
    mockSessionPresent();
    mockAdmin(
      vi.fn().mockReturnValue({
        eq: vi.fn().mockRejectedValue(new Error("ECONNREFUSED supabase")),
      }),
    );
    mockUpstream(TERMINAL_SUCCESS);
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(SECRET_BODY));
    expect(res.status).toBe(500);
    expect(lastCapture()![1].tags?.step).toBe("public-token-persist-threw");
  });

  // ── the policy's NEGATIVE half ────────────────────────────────────────────

  it("NEGATIVE: a caller fault (invalid JSON) is NEVER captured", async () => {
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq("{not json", true));
    expect(res.status).toBe(400);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("NEGATIVE: a caller fault (unsupported exchange) is NEVER captured", async () => {
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...SECRET_BODY, exchange: "nasdaq" }));
    expect(res.status).toBe(400);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("NEGATIVE: an already-classified seam envelope (a breaker 503) is NEVER captured here", async () => {
    // `postProcessKey` returns its own classified response for a breaker trip
    // and the route returns it verbatim at `!result.ok`. That is the expected
    // infrastructure fact the policy excludes — capturing it would fire on
    // every seam route at once during one correlated incident.
    mockSessionPresent();
    mockAdmin(vi.fn());
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({
        ok: false,
        response: new Response(JSON.stringify({ ok: false, code: "CIRCUIT_OPEN" }), {
          status: 503,
        }),
      }),
    }));
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(SECRET_BODY));
    expect(res.status).toBe(503);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("ANTI-REGRESSION: a clean terminal success captures NOTHING", async () => {
    // Without this, a route that captured unconditionally would satisfy every
    // positive case above while making Sentry useless.
    mockSessionPresent();
    mockAdmin(
      vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    );
    mockUpstream(TERMINAL_SUCCESS);
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(SECRET_BODY));
    expect(res.status).toBe(200);
    expect(captureSpy).not.toHaveBeenCalled();
  });
});

/**
 * Phase 140.3-G4 / SEAMUX-03 — a machine `code` on every error arm this PUBLIC
 * teaser route emits, so a client discriminates the fault on a stable token
 * instead of sniffing prose. Mirrors 140.3-10's arm-by-arm pass on `keys/sync`.
 *
 * The requirement text names `/api/verify-strategy` explicitly. At HEAD this
 * route emitted ZERO coded arms (140.3-VERIFICATION §3.1: 0/11).
 *
 * ⚠️ PUBLIC UNAUTHENTICATED ROUTE — every token asserted here is a closed-set
 * clean token that names no env var, hostname, or internal service.
 *
 * ORACLE INDEPENDENCE: every expected code is a hand-typed literal, not imported
 * from the route or any copy table. At least one case asserts the exact
 * `{ error, code }` pair, so a dropped code reddens (not just a changed value).
 */
describe("[140.3-G4 / SEAMUX-03] POST /api/verify-strategy — a machine code on every arm", () => {
  function mockSessionPresent() {
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: {
          getSession: async () => ({
            data: { session: { access_token: "jwt" } },
            error: null,
          }),
        },
      }),
    }));
  }

  function mockUpstream(body: unknown) {
    vi.doMock("@/lib/process-key-client", () => ({
      postProcessKey: vi.fn().mockResolvedValue({ ok: true, status: 200, body }),
    }));
  }

  const TERMINAL_SUCCESS = {
    ok: true,
    code: null,
    verification_id: "99999999-9999-4999-8999-999999999999",
    status: "published",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    verificationCount = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ── the 400 input arms ──
  // 161-09 / WIZERR-08: four of the five moved off KEY_INVALID_FORMAT onto codes
  // true of their own facts. The email arm KEEPS it — a present value whose
  // shape is wrong IS a format failure. The full per-arm inventory with the
  // byte-identical sentences, and the two disclosure pins, are the WIZERR-08
  // suite at the foot of this file.

  it("400 invalid JSON carries the EXACT { error, code } pair", async () => {
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq("{not json", true));
    expect(res.status).toBe(400);
    // The exact-pair case: a dropped code reddens here, not just a changed value.
    expect(await res.json()).toEqual({
      error: "Invalid JSON body",
      code: "KEY_MISSING_REQUIRED_FIELD",
    });
  });

  it("400 missing required fields → code KEY_MISSING_REQUIRED_FIELD", async () => {
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(
      postReq({ email: "test@example.com", exchange: "okx", api_key: "k" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_MISSING_REQUIRED_FIELD");
  });

  it("400 invalid email → code KEY_INVALID_FORMAT (RETAINED — the one real format failure here)", async () => {
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...VALID_BODY, email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_INVALID_FORMAT");
  });

  it("400 unsupported exchange → code KEY_UNSUPPORTED_VENUE", async () => {
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...VALID_BODY, exchange: "kraken" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("KEY_UNSUPPORTED_VENUE");
  });

  it("400 sfox-disabled (half-state) → code KEY_VENUE_NOT_ENABLED", async () => {
    vi.resetModules();
    vi.doMock("@/lib/utils", async () => {
      const actual = (await vi.importActual("@/lib/utils")) as Record<string, unknown>;
      const codes = actual.UI_EXCHANGE_CODES as string[];
      return { ...actual, UI_EXCHANGE_CODES: [...codes, "sfox"] };
    });
    vi.doMock("@/lib/closed-sets", async () => {
      const actual = (await vi.importActual("@/lib/closed-sets")) as Record<string, unknown>;
      return { ...actual, isSfoxEnabledServer: () => false };
    });
    try {
      const { POST } = await import("./route");
      const res = await POST(postReq({ ...VALID_BODY, exchange: "sfox" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("not yet available");
      expect(body.code).toBe("KEY_VENUE_NOT_ENABLED");
    } finally {
      vi.doUnmock("@/lib/utils");
      vi.doUnmock("@/lib/closed-sets");
      vi.resetModules();
    }
  });

  // ── the 502 drift arm: a 2xx whose body we could not recognise ──

  it("502 unrecognised upstream response → code UNKNOWN (an answer arrived; not UNREACHABLE)", async () => {
    mockSessionPresent();
    // ok:true but no verification_id — the DRIFT trigger of the shape guard.
    mockUpstream({ ok: true, code: null, status: "published" });
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe("Verification service returned an invalid response");
    expect(body.code).toBe("UNKNOWN");
  });

  // ── the 500 config arm: OUR misconfiguration ──

  it("500 createAdminClient config fault → code SEAM_MISCONFIGURED", async () => {
    mockSessionPresent();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => {
        throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
      },
    }));
    mockUpstream(TERMINAL_SUCCESS);
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Verification service misconfigured");
    expect(body.code).toBe("SEAM_MISCONFIGURED");
  });

  // ── both persist-failure 500 arms answer the SAME token ──

  it("500 persist error (returned) → code VERIFY_PERSIST_FAILED", async () => {
    mockSessionPresent();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: "row not found" } }),
          }),
        }),
      }),
    }));
    mockUpstream(TERMINAL_SUCCESS);
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to finalize verification");
    expect(body.code).toBe("VERIFY_PERSIST_FAILED");
  });

  it("500 persist failure (THROWN twin) → the SAME code VERIFY_PERSIST_FAILED", async () => {
    mockSessionPresent();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: () => ({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockRejectedValue(new Error("ECONNREFUSED supabase")),
          }),
        }),
      }),
    }));
    mockUpstream(TERMINAL_SUCCESS);
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to finalize verification");
    // Same fact ⇒ same token on both arms (the keys/sync two-throttle-arms doctrine).
    expect(body.code).toBe("VERIFY_PERSIST_FAILED");
  });
});

/**
 * ⭐ 161-09 / WIZERR-08 — THE PUBLIC ROUTE: TRUE CODES, ZERO DISCLOSURE MOVEMENT.
 *
 * ── WHY THE SENTENCES ARE THE THING PINNED, AND NOT THE CODES ───────────────
 *
 * MEASURED at HEAD (2026-08-24), not assumed: the only consumer of this route,
 * `src/components/landing/VerificationForm.tsx`, renders
 * `safeHumanMessage(data.human_message) ?? safeHumanMessage(data.error) ??
 * "Verification failed"` and NEVER reads `data.code`. The two occurrences of
 * the word "code" in that file are both inside comments. So on this route the
 * code channel is machine-only and the SENTENCE is the sole public disclosure
 * surface — re-coding an arm cannot widen what an anonymous caller learns, and
 * moving a sentence would. That is the whole F3 argument, and it is why every
 * case below asserts the sentence as a HAND-TYPED literal transcribed from the
 * pre-161-09 source (`git show HEAD~1:…`), never imported.
 *
 * ⛔ IF A FUTURE CONSUMER STARTS READING `code` ON THIS ROUTE, the premise
 * above stops holding and F3 must be RE-DECIDED — see the latent-hazard note at
 * the sfox arm in `route.ts`. This suite does not detect that; nothing can
 * detect a consumer that does not exist yet. It is recorded, not covered.
 */
describe("[161-09 / WIZERR-08] the anonymous route: honest codes under an unchanged disclosure boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verificationCount = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /**
   * HAND-TYPED. Four of the five arms — the fifth (sfox) needs a two-module
   * re-mock to reach its half-state and gets its own case below.
   *
   * ⚠️ `sentence` is compared with `toBe`, never `toContain`. A `toContain`
   * against a shortened sentence passes; `"anything".includes("")` is `true`,
   * and a blanked expectation would pass against every arm at once.
   */
  const PUBLIC_ARMS: readonly {
    label: string;
    body: unknown;
    raw?: boolean;
    code: string;
    sentence: string;
  }[] = [
    {
      label: "the body was not a readable object",
      body: "{not json",
      raw: true,
      code: "KEY_MISSING_REQUIRED_FIELD",
      sentence: "Invalid JSON body",
    },
    {
      label: "a field the form requires arrived absent",
      body: { email: "test@example.com", exchange: "okx", api_key: "k" },
      code: "KEY_MISSING_REQUIRED_FIELD",
      sentence: "Missing required fields: email, exchange, api_key, api_secret",
    },
    {
      label: "a present value is malformed (the ONE genuine format failure)",
      body: { ...VALID_BODY, email: "not-an-email" },
      code: "KEY_INVALID_FORMAT",
      sentence: "Invalid email address",
    },
    {
      label: "the venue is outside the offered set",
      body: { ...VALID_BODY, exchange: "kraken" },
      code: "KEY_UNSUPPORTED_VENUE",
      sentence: `Unsupported exchange. Supported: ${UI_EXCHANGE_CODES.join(", ")}`,
    },
  ];

  // Positive control FIRST: a table that shrank reports no failures.
  it("the arm table is the four MEASURED non-sfox arms", () => {
    expect(PUBLIC_ARMS.length).toBe(4);
    // And every hand-typed sentence is a real sentence. A blank or near-blank
    // expectation would satisfy a `toContain` everywhere and a `toBe` nowhere
    // useful; this makes the guard explicit rather than relying on the operator.
    for (const a of PUBLIC_ARMS) expect(a.sentence.trim().length).toBeGreaterThan(10);
  });

  it.each(PUBLIC_ARMS.map((a) => [a.label, a] as const))(
    "%s → its own code, sentence byte-identical, still 400",
    async (_label, arm) => {
      vi.resetModules();
      const { POST } = await import("./route");
      const res = await POST(postReq(arm.body, arm.raw ?? false));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe(arm.code);
      expect(body.error).toBe(arm.sentence);
      // Nothing was forwarded to the teaser pipeline on any refusal.
      expect(verifyStrategyMock).not.toHaveBeenCalled();
    },
  );

  it("the venue-not-enabled arm → KEY_VENUE_NOT_ENABLED, sentence byte-identical", async () => {
    vi.resetModules();
    vi.doMock("@/lib/utils", async () => {
      const actual = (await vi.importActual("@/lib/utils")) as Record<string, unknown>;
      const codes = actual.UI_EXCHANGE_CODES as string[];
      return { ...actual, UI_EXCHANGE_CODES: [...codes, "sfox"] }; // offer ON
    });
    vi.doMock("@/lib/closed-sets", async () => {
      const actual = (await vi.importActual("@/lib/closed-sets")) as Record<string, unknown>;
      return { ...actual, isSfoxEnabledServer: () => false }; // server flag OFF
    });
    try {
      const { POST } = await import("./route");
      const res = await POST(postReq({ ...VALID_BODY, exchange: "sfox" }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.code).toBe("KEY_VENUE_NOT_ENABLED");
      expect(body.error).toBe("sFOX integration is not yet available.");
      expect(verifyStrategyMock).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/utils");
      vi.doUnmock("@/lib/closed-sets");
      vi.resetModules();
    }
  });

  /**
   * ⭐ THE ORDERING PIN — this is what BOUNDS the disclosure, so it is asserted
   * rather than inherited from a comment.
   *
   * The offered-set gate must run BEFORE the venue-disabled gate. With that
   * ordering, the venue-disabled arm is reachable ONLY for a venue the landing
   * form is already offering, so it cannot name an unlaunched venue. Reverse
   * the two and a venue outside the offer would be answered "sFOX integration
   * is not yet available." — a coming-soon signal about something we never
   * offered. (Threat T-161-27.)
   */
  it("F3 ORDERING: a venue OUTSIDE the offered set is refused by the offered-set gate, never by the venue-disabled gate", async () => {
    vi.resetModules();
    // The offer is at its real value (sfox NOT in it) while the server flag is
    // OFF — the exact configuration in which a reversed ordering would leak.
    vi.doMock("@/lib/closed-sets", async () => {
      const actual = (await vi.importActual("@/lib/closed-sets")) as Record<string, unknown>;
      return { ...actual, isSfoxEnabledServer: () => false };
    });
    try {
      const { POST } = await import("./route");
      const res = await POST(postReq({ ...VALID_BODY, exchange: "sfox" }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.code).toBe("KEY_UNSUPPORTED_VENUE");
      expect(body.error).toBe(
        `Unsupported exchange. Supported: ${UI_EXCHANGE_CODES.join(", ")}`,
      );
      // The venue-disabled sentence must NOT be what an unoffered venue is told.
      expect(body.error).not.toContain("not yet available");
    } finally {
      vi.doUnmock("@/lib/closed-sets");
      vi.resetModules();
    }
  });

  /**
   * ⭐ THE ENUMERATION BOUND — what the public "Supported: …" list may name.
   *
   * ⛔ THE EXPECTATION IS DERIVED FROM `UI_EXCHANGE_CODES`, NEVER HAND-LISTED.
   * A hand-typed venue list in a test IS ITSELF a stale disclosure claim the
   * day the offer changes: it would keep passing while the route disclosed
   * something the list no longer described. The offered set is the disclosure
   * boundary, so the offered set is the oracle.
   *
   * The complement is the half that matters: every venue in the WIDER key-save
   * allowlist that is NOT offered must be absent from the disclosed string.
   */
  it("F3 ENUMERATION: the disclosed list is EXACTLY the offered set, and names nothing wider", async () => {
    vi.resetModules();
    const { POST } = await import("./route");
    const res = await POST(postReq({ ...VALID_BODY, exchange: "kraken" }));
    const body = await res.json();
    expect(res.status).toBe(400);

    // Both oracles must be non-empty before either claim below means anything:
    // an empty offered set makes the "names nothing wider" half vacuous, and
    // `"anything".includes("")` is true.
    expect(UI_EXCHANGE_CODES.length).toBeGreaterThan(1);
    expect(SUPPORTED_EXCHANGES.length).toBeGreaterThanOrEqual(UI_EXCHANGE_CODES.length);

    expect(body.error).toBe(
      `Unsupported exchange. Supported: ${UI_EXCHANGE_CODES.join(", ")}`,
    );

    const notOffered = SUPPORTED_EXCHANGES.filter(
      (v) => !(UI_EXCHANGE_CODES as readonly string[]).includes(v),
    );
    // Non-vacuity: if the two sets ever coincide this half proves nothing, and
    // a green from an empty filter is indistinguishable from a real pass.
    expect(
      notOffered.length,
      "the key-save allowlist and the public offer coincide, so the " +
        "'names nothing wider' half is measuring nothing. If a venue was " +
        "launched, that is fine and this pin should be re-derived; if the " +
        "allowlist shrank to the offer, say so deliberately.",
    ).toBeGreaterThan(0);
    for (const venue of notOffered) {
      expect(
        body.error.toLowerCase(),
        `the anonymous disclosure names ${venue}, which is in the key-save ` +
          `allowlist but NOT in the public offer (F3)`,
      ).not.toContain(venue.toLowerCase());
    }
  });
});
