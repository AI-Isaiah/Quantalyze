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
 * ⚠️ THIS ROUTE IS THE SECRET-BEARING ONE OF THIS PLAN'S FOUR. It holds a LIVE
 * user Supabase JWT and the caller's RAW exchange credentials at the same time.
 * `140.3-02` closed a live end-user JWT log leak one wave-set ago; an
 * observability channel added here must not re-open it through Sentry.
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

  /** A session IS readable, so the JWT is in scope and must be named. */
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

  it("🔴 THE SECRETS ARGUMENT: every capture NAMES the live JWT and both raw exchange credentials", async () => {
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
    expect(secrets).toContain(LIVE_JWT);
    expect(secrets).toContain(RAW_API_KEY);
    expect(secrets).toContain(RAW_API_SECRET);
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
    expect(capture![1].secrets).toContain(LIVE_JWT);
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
